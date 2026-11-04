import "server-only";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** Minimal text-completion port. Services depend on this, never on a vendor SDK. */
export type TaskPlanProvider = {
  /** Provider label stored with each plan, for example the endpoint host. */
  name: string;
  model: string;
  complete(input: { system: string; user: string }): Promise<string>;
  /** Like `complete`, plus the token counts the provider reported (when it does). */
  generate?(input: { system: string; user: string }): Promise<Completion>;
};

export type Completion = {
  text: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
};

/** Generic name for the same port, used by features other than task planning. */
export type TextProvider = TaskPlanProvider;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_500;

/**
 * OpenAI-compatible chat completions adapter. Returns null when AI is not
 * configured so callers can show a disabled state instead of failing.
 */
export function getTaskPlanProvider(): TaskPlanProvider | null {
  const { AI_BASE_URL, AI_API_KEY, AI_MODEL, AI_JSON_MODE, AI_MAX_OUTPUT_TOKENS, AI_TIMEOUT_MS } =
    env();
  if (!AI_BASE_URL || !AI_MODEL) return null;
  return createOpenAiCompatibleProvider({
    baseUrl: AI_BASE_URL,
    apiKey: AI_API_KEY,
    model: AI_MODEL,
    jsonMode: AI_JSON_MODE,
    maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    timeoutMs: AI_TIMEOUT_MS,
  });
}

export function createOpenAiCompatibleProvider(options: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /**
   * Ask the server for JSON mode (`response_format: json_object`). Turn it off for servers that
   * reject it, such as LM Studio (HTTP 400); the prompts already ask for JSON and the planner
   * extracts the JSON object from the text.
   */
  jsonMode?: boolean;
  /** Reasoning models spend part of this on thinking, so they may need more than the default. */
  maxOutputTokens?: number;
  /** How long to wait for an answer. Reasoning models on modest hardware can need a minute or more. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): TaskPlanProvider {
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const doFetch = options.fetchImpl ?? fetch;
  const provider: TaskPlanProvider = {
    name: new URL(options.baseUrl).host,
    model: options.model,
    async complete(input) {
      return (await provider.generate!(input)).text;
    },
    async generate({ system, user }) {
      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: options.model,
            temperature: 0.3,
            max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            ...(options.jsonMode === false ? {} : { response_format: { type: "json_object" } }),
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (error) {
        // Never log prompts or responses; they contain workspace content.
        logger.warn({ err: error }, "ai.provider request failed");
        throw new AppError("UNPROCESSABLE", "The AI service is unavailable.");
      }
      if (!response.ok) {
        logger.warn({ status: response.status }, "ai.provider returned an error status");
        throw new AppError("UNPROCESSABLE", "The AI service is unavailable.");
      }
      const body = (await response.json().catch(() => null)) as {
        choices?: { message?: { content?: unknown } }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      } | null;
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new AppError("UNPROCESSABLE", "The AI service returned an empty answer.");
      }
      const count = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) && value >= 0
          ? Math.round(value)
          : null;
      return {
        text: content,
        usage: {
          inputTokens: count(body?.usage?.prompt_tokens),
          outputTokens: count(body?.usage?.completion_tokens),
        },
      };
    },
  };
  return provider;
}
