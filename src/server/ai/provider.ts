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

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1_500;

/**
 * OpenAI-compatible chat completions adapter. Returns null when AI is not
 * configured so callers can show a disabled state instead of failing.
 */
export function getTaskPlanProvider(): TaskPlanProvider | null {
  const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = env();
  if (!AI_BASE_URL || !AI_MODEL) return null;
  return createOpenAiCompatibleProvider({
    baseUrl: AI_BASE_URL,
    apiKey: AI_API_KEY,
    model: AI_MODEL,
  });
}

export function createOpenAiCompatibleProvider(options: {
  baseUrl: string;
  apiKey?: string;
  model: string;
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
            max_tokens: MAX_OUTPUT_TOKENS,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
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
