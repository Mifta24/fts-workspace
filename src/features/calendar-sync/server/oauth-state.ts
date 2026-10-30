import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SecretBox } from "@/server/security/secret-box";

/**
 * What the consent round trip must remember, kept in a short-lived cookie that only the server
 * can read or forge (it is sealed, so the browser sees an opaque value). It binds the `state`
 * Google echoes back to the person and the workspace that started the connection.
 */
const statePayload = z.object({
  state: z.string().min(16),
  userId: z.string().min(1),
  organizationSlug: z.string().min(1),
  locale: z.string().min(1),
  expiresAt: z.number(),
});
export type OAuthState = z.infer<typeof statePayload>;

const CONTEXT = "google-oauth-state";

export const sealOAuthState = (box: SecretBox, payload: OAuthState): string =>
  box.seal(JSON.stringify(payload), CONTEXT);

/** The payload, or null when the value is missing, altered, malformed or past its time. */
export function openOAuthState(
  box: SecretBox,
  sealed: string | undefined,
  now: Date,
): OAuthState | null {
  if (!sealed) return null;
  try {
    const parsed = statePayload.safeParse(JSON.parse(box.open(sealed, CONTEXT)));
    return parsed.success && parsed.data.expiresAt > now.getTime() ? parsed.data : null;
  } catch {
    return null;
  }
}

export function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
