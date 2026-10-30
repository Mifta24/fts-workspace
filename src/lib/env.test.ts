import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BASE = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(40),
  BETTER_AUTH_URL: "http://localhost:3000",
};
const KEY = Buffer.alloc(32, 7).toString("base64");

/** Loads a fresh copy of the module under the given environment (it caches the first result). */
async function load(values: Record<string, string | undefined>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const name of Object.keys(process.env)) {
    if (/^(GOOGLE_|SMTP_|EMAIL_|CALENDAR_|TURNSTILE_)/.test(name))
      vi.stubEnv(name, undefined as never);
  }
  for (const [name, value] of Object.entries({ ...BASE, ...values })) {
    vi.stubEnv(name, value as never);
  }
  return (await import("@/lib/env")).env;
}

describe("environment validation", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the log transport and no optional integrations", async () => {
    const env = await load({ EMAIL_TRANSPORT: "log" });
    expect(env().EMAIL_TRANSPORT).toBe("log");
  });

  describe("email", () => {
    it("needs a smtp:// or smtps:// URL for the smtp transport", async () => {
      const missing = await load({ EMAIL_TRANSPORT: "smtp" });
      expect(() => missing()).toThrow(/SMTP_URL/);
      const wrong = await load({ EMAIL_TRANSPORT: "smtp", SMTP_URL: "https://mail.example.test" });
      expect(() => wrong()).toThrow(/SMTP_URL/);
      const ok = await load({
        EMAIL_TRANSPORT: "smtp",
        SMTP_URL: "smtps://user:secret@smtp.example.test:465",
      });
      expect(ok().EMAIL_TRANSPORT).toBe("smtp");
    });

    it("refuses the log transport in production, and allows smtp there", async () => {
      const logged = await load({ NODE_ENV: "production", EMAIL_TRANSPORT: "log" });
      expect(() => logged()).toThrow(/not allowed in production/);
      const smtp = await load({
        NODE_ENV: "production",
        EMAIL_TRANSPORT: "smtp",
        SMTP_URL: "smtps://user:secret@smtp.example.test:465",
      });
      expect(smtp().EMAIL_TRANSPORT).toBe("smtp");
    });

    it("does not put the SMTP password in the error message", async () => {
      const wrong = await load({ EMAIL_TRANSPORT: "smtp", SMTP_URL: "ftp://user:hunter2@x.test" });
      try {
        wrong();
        throw new Error("expected a throw");
      } catch (error) {
        expect(String(error)).not.toContain("hunter2");
      }
    });
  });

  describe("google calendar", () => {
    it("needs both OAuth values, and a token key when it is on", async () => {
      const half = await load({ GOOGLE_CLIENT_ID: "id" });
      expect(() => half()).toThrow(/GOOGLE_CLIENT_ID/);
      const noKey = await load({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" });
      expect(() => noKey()).toThrow(/CALENDAR_TOKEN_KEY/);
      const badKey = await load({
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "s",
        CALENDAR_TOKEN_KEY: "too-short",
      });
      expect(() => badKey()).toThrow(/CALENDAR_TOKEN_KEY/);
      const ok = await load({
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "s",
        CALENDAR_TOKEN_KEY: KEY,
      });
      expect(ok().GOOGLE_CLIENT_ID).toBe("id");
    });
  });
});
