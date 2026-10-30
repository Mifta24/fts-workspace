import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "@/lib/auth/auth";
import { db } from "@/lib/db";
import { resetDatabase } from "../helpers/db";

const URL = "http://localhost:3000/api/auth/sign-in/email";

/** Two separate Better Auth instances stand in for two app processes behind one load balancer. */
const instance = () => createAuth({ rateLimit: { enabled: true } });

function signIn(auth: ReturnType<typeof createAuth>, ip: string) {
  return auth.handler(
    new Request(URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email: "nobody@example.test", password: "not-the-password-123" }),
    }),
  );
}

describe("authentication rate limit", () => {
  beforeEach(resetDatabase);

  it("counts requests in the database, so separate app instances share one allowance", async () => {
    const a = instance();
    const b = instance();
    // Better Auth allows three sign-in attempts per ten seconds from one address.
    const statuses: number[] = [];
    for (const auth of [a, b, a, b, a]) statuses.push((await signIn(auth, "203.0.113.7")).status);

    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses.slice(3)).toEqual([429, 429]);
    // Each instance alone saw at most three requests: only shared storage explains the refusal.
    const rows = await db().rateLimit.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 3 });
    expect(rows[0]!.key).toContain("203.0.113.7");
  });

  it("limits each address on its own", async () => {
    const auth = instance();
    for (let i = 0; i < 4; i += 1) await signIn(auth, "203.0.113.8");
    expect((await signIn(auth, "203.0.113.8")).status).toBe(429);
    expect((await signIn(auth, "203.0.113.9")).status).not.toBe(429);
  });

  it("tells a limited caller when to try again", async () => {
    const auth = instance();
    for (let i = 0; i < 3; i += 1) await signIn(auth, "203.0.113.10");
    const refused = await signIn(auth, "203.0.113.10");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("x-retry-after"))).toBeGreaterThan(0);
  });

  it("is off by default outside production, so development and the other tests are not slowed down", async () => {
    const auth = createAuth();
    for (let i = 0; i < 6; i += 1) {
      expect((await signIn(auth, "203.0.113.11")).status).not.toBe(429);
    }
    expect(await db().rateLimit.count()).toBe(0);
  });
});
