import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 10_000;
/** Cloudflare documents tokens of at most 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;
/** Name of the field the Turnstile widget adds to the surrounding form. */
export const CAPTCHA_FIELD = "cf-turnstile-response";

/** The widget's public key when Turnstile is configured; null means the anonymous forms run without it. */
export function captchaSiteKey(): string | null {
  const { TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY } = env();
  return TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY ? TURNSTILE_SITE_KEY : null;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Checks a Turnstile token with Cloudflare's Siteverify API. Tokens are single use and expire
 * after five minutes, so a replayed or stale token fails. Any problem reaching Cloudflare also
 * fails: a visitor can retry, whereas letting requests through would turn an outage into an
 * open door. Returns true when no captcha is configured.
 */
export async function verifyCaptcha(
  token: unknown,
  options: { remoteIp?: string | null; fetcher?: Fetcher } = {},
): Promise<boolean> {
  const { TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY } = env();
  if (!TURNSTILE_SITE_KEY || !TURNSTILE_SECRET_KEY) return true;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return false;
  }
  const body = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token });
  if (options.remoteIp) body.set("remoteip", options.remoteIp);
  try {
    const response = await (options.fetcher ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "captcha verification unavailable");
      return false;
    }
    const result = (await response.json()) as { success?: unknown; "error-codes"?: unknown };
    if (result.success !== true) {
      logger.info({ codes: result["error-codes"] }, "captcha rejected");
      return false;
    }
    return true;
  } catch (error) {
    logger.warn({ err: error }, "captcha verification failed");
    return false;
  }
}
