import { beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/lib/auth/auth";
import { testOutbox } from "@/lib/email";
import { resetDatabase } from "../helpers/db";

const BASE = "http://localhost:3000/api/auth";
const PASSWORD = "correct-horse-battery-staple";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return getAuth().handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function get(url: string, headers: Record<string, string> = {}) {
  return getAuth().handler(
    new Request(url, { headers: { origin: "http://localhost:3000", ...headers } }),
  );
}

function sessionCookie(response: Response): string {
  const cookies = response.headers.getSetCookie();
  const token = cookies.find((c) => c.startsWith("better-auth.session_token="));
  if (!token) throw new Error("no session cookie");
  return token.split(";")[0]!;
}

function lastEmailLink(): string {
  const message = testOutbox.at(-1);
  const match = message?.text.match(/https?:\/\/\S+/);
  if (!match) throw new Error("no link in email");
  return match[0];
}

describe("authentication", () => {
  beforeEach(async () => {
    await resetDatabase();
    testOutbox.length = 0;
  });

  it("requires email verification before sign-in, then issues a session", async () => {
    const signUp = await post("/sign-up/email", {
      name: "Alice",
      email: "alice@example.test",
      password: PASSWORD,
    });
    expect(signUp.status).toBe(200);
    expect(testOutbox).toHaveLength(1);
    expect(testOutbox[0]!.to).toBe("alice@example.test");

    const blocked = await post("/sign-in/email", {
      email: "alice@example.test",
      password: PASSWORD,
    });
    expect(blocked.status).toBe(403);

    const verify = await get(lastEmailLink());
    expect(verify.status).toBeLessThan(400);

    const signIn = await post("/sign-in/email", {
      email: "alice@example.test",
      password: PASSWORD,
    });
    expect(signIn.status).toBe(200);
    const cookie = sessionCookie(signIn);
    expect(signIn.headers.getSetCookie().join(";").toLowerCase()).toContain("httponly");

    const session = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe("alice@example.test");
    expect(session?.user.emailVerified).toBe(true);
  });

  it("rejects wrong passwords and short passwords", async () => {
    const short = await post("/sign-up/email", {
      name: "Bob",
      email: "bob@example.test",
      password: "short",
    });
    expect(short.status).toBe(400);

    await post("/sign-up/email", { name: "Bob", email: "bob@example.test", password: PASSWORD });
    await get(lastEmailLink());
    const wrong = await post("/sign-in/email", {
      email: "bob@example.test",
      password: "wrong-password-123",
    });
    expect(wrong.status).toBe(401);
  });

  it("resets a password with the emailed token and revokes old sessions", async () => {
    await post("/sign-up/email", {
      name: "Carol",
      email: "carol@example.test",
      password: PASSWORD,
    });
    await get(lastEmailLink());
    const signIn = await post("/sign-in/email", {
      email: "carol@example.test",
      password: PASSWORD,
    });
    const oldCookie = sessionCookie(signIn);

    const request = await post("/request-password-reset", {
      email: "carol@example.test",
      redirectTo: "/en/reset-password",
    });
    expect(request.status).toBe(200);
    const token = new URL(lastEmailLink()).pathname.split("/").at(-1)!;

    const newPassword = "another-long-password-456";
    const reset = await post("/reset-password", { token, newPassword });
    expect(reset.status).toBe(200);

    expect(
      await getAuth().api.getSession({ headers: new Headers({ cookie: oldCookie }) }),
    ).toBeNull();
    const old = await post("/sign-in/email", { email: "carol@example.test", password: PASSWORD });
    expect(old.status).toBe(401);
    const fresh = await post("/sign-in/email", {
      email: "carol@example.test",
      password: newPassword,
    });
    expect(fresh.status).toBe(200);
  });

  it("does not reveal whether an email is registered on reset requests", async () => {
    const response = await post("/request-password-reset", {
      email: "nobody@example.test",
      redirectTo: "/en/reset-password",
    });
    expect(response.status).toBe(200);
    expect(testOutbox).toHaveLength(0);
  });
});
