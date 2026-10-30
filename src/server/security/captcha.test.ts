import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

/** `env()` caches its first read, so each test loads fresh modules after setting the variables. */
async function load(site?: string, secret?: string) {
  for (const [key, value] of [
    ["TURNSTILE_SITE_KEY", site],
    ["TURNSTILE_SECRET_KEY", secret],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return import("@/server/security/captcha");
}

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("captcha", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("is off, and lets requests through untouched, without both keys", async () => {
    const off = await load();
    const fetcher = vi.fn();
    expect(off.captchaSiteKey()).toBeNull();
    expect(await off.verifyCaptcha(undefined, { fetcher })).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a configuration with only one of the two keys", async () => {
    const half = await load("site-only", undefined);
    const { env } = await import("@/lib/env");
    expect(() => env()).toThrow(/Invalid server environment configuration/);
    expect(half).toBeDefined();
    const other = await load(undefined, "secret-only");
    expect(other).toBeDefined();
    const again = await import("@/lib/env");
    expect(() => again.env()).toThrow(/Invalid server environment configuration/);
  });

  it("exposes only the public key", async () => {
    const captcha = await load("1x00000000000000000000AA", "1x0000000000000000000000000000000AA");
    expect(captcha.captchaSiteKey()).toBe("1x00000000000000000000AA");
  });

  it("rejects missing, empty, oversized and non-string tokens without calling Cloudflare", async () => {
    const captcha = await load("site", "secret");
    const fetcher = vi.fn();
    for (const token of [undefined, null, "", "x".repeat(2049), 42, {}, ["a"]]) {
      expect(await captcha.verifyCaptcha(token, { fetcher })).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the secret, token and address to Siteverify and accepts only success", async () => {
    const captcha = await load("site", "secret-value");
    const fetcher = answer({ success: true });
    expect(await captcha.verifyCaptcha("token-1", { remoteIp: "203.0.113.9", fetcher })).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("secret-value");
    expect(body.get("response")).toBe("token-1");
    expect(body.get("remoteip")).toBe("203.0.113.9");

    // The address is optional.
    const bare = answer({ success: true });
    await captcha.verifyCaptcha("token-2", { fetcher: bare });
    expect(
      ((bare.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams).has(
        "remoteip",
      ),
    ).toBe(false);
  });

  it("fails closed on rejection, truthy lookalikes, errors and outages", async () => {
    const captcha = await load("site", "secret");
    const cases = [
      answer({ success: false, "error-codes": ["timeout-or-duplicate"] }),
      answer({ success: "true" }),
      answer({ success: 1 }),
      answer({}),
      answer({ success: true }, 500),
      answer({ success: true }, 403),
      vi.fn(async () => new Response("not json", { status: 200 })),
      vi.fn(async () => {
        throw new Error("network down");
      }),
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    ];
    for (const fetcher of cases) {
      expect(await captcha.verifyCaptcha("token", { fetcher })).toBe(false);
    }
  });
});
