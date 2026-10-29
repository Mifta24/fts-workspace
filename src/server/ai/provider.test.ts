import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleProvider } from "@/server/ai/provider";

const ok = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("OpenAI-compatible provider", () => {
  it("posts a bounded JSON-mode request and returns the message text", async () => {
    const fetchImpl = vi.fn(async () => ok('{"tasks":[]}'));
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://127.0.0.1:1234/v1/",
      apiKey: "k-123",
      model: "local-model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(provider).toMatchObject({ name: "127.0.0.1:1234", model: "local-model" });
    await expect(provider.complete({ system: "s", user: "u" })).resolves.toBe('{"tasks":[]}');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k-123");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "local-model",
      max_tokens: 1500,
      response_format: { type: "json_object" },
    });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
  });

  it("omits the authorization header without a key", async () => {
    const fetchImpl = vi.fn(async () => ok("{}"));
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://localhost:1234/v1",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await provider.complete({ system: "s", user: "u" });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("turns network errors, bad statuses and empty answers into a generic failure", async () => {
    const make = (fetchImpl: unknown) =>
      createOpenAiCompatibleProvider({
        baseUrl: "http://localhost:1234/v1",
        model: "m",
        fetchImpl: fetchImpl as typeof fetch,
      });
    await expect(
      make(async () => {
        throw new Error("secret-detail ECONNREFUSED");
      }).complete({ system: "s", user: "u" }),
    ).rejects.toThrow("The AI service is unavailable.");
    await expect(
      make(async () => new Response("nope", { status: 500 })).complete({ system: "s", user: "u" }),
    ).rejects.toThrow("The AI service is unavailable.");
    await expect(make(async () => ok("")).complete({ system: "s", user: "u" })).rejects.toThrow(
      "empty answer",
    );
    await expect(make(async () => ok(42)).complete({ system: "s", user: "u" })).rejects.toThrow(
      "empty answer",
    );
  });
});
