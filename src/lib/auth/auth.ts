import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

/**
 * Sends an auth email without making the request wait for the mail server. Waiting would let
 * anyone tell registered addresses from unknown ones by response time (only known addresses
 * trigger an email). A failed delivery is logged by `sendEmail`; the person can ask again.
 */
function deliver(message: Parameters<typeof sendEmail>[0]): void {
  void sendEmail(message).catch(() => undefined);
}

type RateLimitOptions = NonNullable<Parameters<typeof betterAuth>[0]["rateLimit"]>;

/** `overrides` exist for tests (the limiter is off outside production unless asked for). */
export function createAuth(overrides: { rateLimit?: RateLimitOptions } = {}) {
  const config = env();
  return betterAuth({
    appName: "FTS Workspace",
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: prismaAdapter(db(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 30,
      sendResetPassword: async ({ user, url }) => {
        deliver({
          to: user.email,
          subject: "Reset your FTS Workspace password",
          text: `Use this link to reset your password (valid for 30 minutes):\n${url}`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        deliver({
          to: user.email,
          subject: "Verify your FTS Workspace email",
          text: `Confirm your email address:\n${url}`,
        });
      },
    },
    // Counters live in the database, so every app instance shares them; the default in-process
    // memory would give each instance its own allowance.
    rateLimit: {
      enabled: config.NODE_ENV === "production",
      storage: "database",
      ...overrides.rateLimit,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: config.NODE_ENV === "production",
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { auth?: Auth };

/** Lazily-created Better Auth instance so builds do not require runtime secrets. */
export function getAuth(): Auth {
  globalForAuth.auth ??= createAuth();
  return globalForAuth.auth;
}
