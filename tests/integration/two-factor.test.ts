import { beforeEach, describe, expect, it } from "vitest";
import { mfaRequired } from "@/features/auth/server/mfa-policy";
import { getAuth } from "@/lib/auth/auth";
import { db } from "@/lib/db";
import { testOutbox } from "@/lib/email";
import { resetDatabase } from "../helpers/db";
import { totpFromUri } from "../helpers/totp";

const BASE = "http://localhost:3000/api/auth";
const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "mfa@example.test";

function post(path: string, body: unknown, cookie = "") {
  return getAuth().handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
      body: JSON.stringify(body),
    }),
  );
}

const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
/** A session cookie with a value; the cleared cookie sent while a code is pending does not count. */
const hasSession = (response: Response) =>
  response.headers
    .getSetCookie()
    .some((value) => /^better-auth\.session_token=[^;]+/.test(value) && !/max-age=0/i.test(value));

async function signedUpUser() {
  await post("/sign-up/email", { name: "Mfa", email: EMAIL, password: PASSWORD });
  const link = testOutbox.at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error("no verification link");
  await getAuth().handler(new Request(link, { headers: { origin: "http://localhost:3000" } }));
  return db().user.findUniqueOrThrow({ where: { email: EMAIL } });
}

/** Signs in and turns on two-step sign-in; returns the authenticator URI and the recovery codes. */
async function turnOn() {
  const signIn = await post("/sign-in/email", { email: EMAIL, password: PASSWORD });
  const cookie = cookiesOf(signIn);
  const enabled = await post("/two-factor/enable", { password: PASSWORD }, cookie);
  expect(enabled.status).toBe(200);
  const { totpURI, backupCodes } = (await enabled.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const confirmed = await post("/two-factor/verify-totp", { code: totpFromUri(totpURI) }, cookie);
  expect(confirmed.status).toBe(200);
  return { totpURI, backupCodes, cookie: cookiesOf(confirmed) || cookie };
}

describe("two-step sign-in", () => {
  beforeEach(async () => {
    await resetDatabase();
    testOutbox.length = 0;
  });

  it("is off until the first code is confirmed", async () => {
    const user = await signedUpUser();
    const signIn = await post("/sign-in/email", { email: EMAIL, password: PASSWORD });
    const enabled = await post("/two-factor/enable", { password: PASSWORD }, cookiesOf(signIn));
    expect(enabled.status).toBe(200);
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(
      false,
    );
  });

  it("asks for a code after the password, and gives no session without it", async () => {
    const user = await signedUpUser();
    const { totpURI } = await turnOn();
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(
      true,
    );

    const again = await post("/sign-in/email", { email: EMAIL, password: PASSWORD });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    expect(hasSession(again)).toBe(false);
    const challenge = cookiesOf(again);

    const wrong = await post("/two-factor/verify-totp", { code: "000000" }, challenge);
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(hasSession(wrong)).toBe(false);

    const right = await post("/two-factor/verify-totp", { code: totpFromUri(totpURI) }, challenge);
    expect(right.status).toBe(200);
    expect(hasSession(right)).toBe(true);
  });

  it("accepts a recovery code once", async () => {
    await signedUpUser();
    const { backupCodes } = await turnOn();
    const first = await post("/sign-in/email", { email: EMAIL, password: PASSWORD });
    const used = await post(
      "/two-factor/verify-backup-code",
      { code: backupCodes[0] },
      cookiesOf(first),
    );
    expect(used.status).toBe(200);
    expect(hasSession(used)).toBe(true);

    const second = await post("/sign-in/email", { email: EMAIL, password: PASSWORD });
    const reused = await post(
      "/two-factor/verify-backup-code",
      { code: backupCodes[0] },
      cookiesOf(second),
    );
    expect(reused.status).toBeGreaterThanOrEqual(400);
    expect(hasSession(reused)).toBe(false);
  });

  it("turns off only with the password", async () => {
    const user = await signedUpUser();
    const { cookie } = await turnOn();
    const wrong = await post(
      "/two-factor/disable",
      { password: "not-the-password-at-all" },
      cookie,
    );
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(
      true,
    );
    const off = await post("/two-factor/disable", { password: PASSWORD }, cookie);
    expect(off.status).toBe(200);
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(
      false,
    );
  });

  it("keeps the secret and recovery codes encrypted in the database", async () => {
    const user = await signedUpUser();
    const { totpURI, backupCodes } = await turnOn();
    const row = await db().twoFactor.findFirstOrThrow({ where: { userId: user.id } });
    const secret = new URL(totpURI).searchParams.get("secret") ?? "";
    expect(row.secret).not.toContain(secret);
    for (const code of backupCodes) expect(row.backupCodes).not.toContain(code);
  });
});

describe("who must have two-step sign-in", () => {
  it("always applies to operators and only to owners when switched on", () => {
    const off = { twoFactorEnabled: false };
    expect(mfaRequired({ ...off, isOperator: true })).toBe(true);
    expect(mfaRequired({ ...off, isOwner: true, ownersRequired: false })).toBe(false);
    expect(mfaRequired({ ...off, isOwner: true, ownersRequired: true })).toBe(true);
    expect(mfaRequired({ ...off, ownersRequired: true })).toBe(false);
    expect(mfaRequired({ twoFactorEnabled: true, isOperator: true })).toBe(false);
    expect(mfaRequired({ twoFactorEnabled: true, isOwner: true, ownersRequired: true })).toBe(
      false,
    );
  });
});
