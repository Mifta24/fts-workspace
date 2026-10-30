import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  openOAuthState,
  sameState,
  sealOAuthState,
  type OAuthState,
} from "@/features/calendar-sync/server/oauth-state";
import { createSecretBox } from "@/server/security/secret-box";

const NOW = new Date("2026-11-02T08:00:00Z");
const box = createSecretBox(randomBytes(32));
const payload: OAuthState = {
  state: "s".repeat(32),
  userId: "user-1",
  organizationSlug: "acme",
  locale: "en",
  expiresAt: NOW.getTime() + 60_000,
};

describe("OAuth state cookie", () => {
  it("round-trips while it is fresh", () => {
    expect(openOAuthState(box, sealOAuthState(box, payload), NOW)).toEqual(payload);
  });

  it("is rejected when expired, missing, altered or sealed elsewhere", () => {
    const sealed = sealOAuthState(box, payload);
    expect(openOAuthState(box, sealed, new Date(payload.expiresAt))).toBeNull();
    expect(openOAuthState(box, undefined, NOW)).toBeNull();
    expect(openOAuthState(box, `${sealed}x`, NOW)).toBeNull();
    expect(openOAuthState(box, JSON.stringify(payload), NOW)).toBeNull();
    expect(openOAuthState(createSecretBox(randomBytes(32)), sealed, NOW)).toBeNull();
    // A different kind of sealed value (another context) is not accepted as state.
    expect(openOAuthState(box, box.seal(JSON.stringify(payload), "other"), NOW)).toBeNull();
  });

  it("rejects a payload of the wrong shape", () => {
    const sealed = box.seal(JSON.stringify({ ...payload, state: "short" }), "google-oauth-state");
    expect(openOAuthState(box, sealed, NOW)).toBeNull();
  });

  it("compares states without accepting near misses", () => {
    expect(sameState("abc", "abc")).toBe(true);
    expect(sameState("abc", "abd")).toBe(false);
    expect(sameState("abc", "abcd")).toBe(false);
  });
});
