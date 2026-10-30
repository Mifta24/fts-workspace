import "server-only";
import { z } from "zod";
import { parseSecretKey } from "@/server/security/secret-box";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    BETTER_AUTH_URL: z.url(),
    EMAIL_TRANSPORT: z.enum(["log"]).default("log"),
    EMAIL_FROM: z.string().min(1).default("FTS Workspace <no-reply@localhost>"),
    // Optional OpenAI-compatible chat endpoint (OpenRouter or a local LM Studio).
    // AI planning is disabled unless AI_BASE_URL and AI_MODEL are both set.
    AI_BASE_URL: z.url().optional(),
    AI_API_KEY: z.string().min(1).optional(),
    AI_MODEL: z.string().min(1).optional(),
    // Realtime gateway (Socket.IO). Without REALTIME_URL the app publishes nothing and works
    // exactly as before; the gateway only broadcasts identifiers.
    REALTIME_URL: z.url().optional(),
    // Browser-facing gateway URL (may differ from the internal REALTIME_URL).
    REALTIME_PUBLIC_URL: z.url().optional(),
    REALTIME_PUBLISH_SECRET: z
      .string()
      .min(32, "REALTIME_PUBLISH_SECRET must be at least 32 characters")
      .optional(),
    // Directory for uploaded files (local-disk storage adapter). Private; never served statically.
    STORAGE_DIR: z.string().min(1).default(".data/files"),
    // Optional Cloudflare Turnstile for the anonymous forms (public forms and booking pages).
    // Both keys or neither: without them those forms rely on the honeypot and the volume limits.
    TURNSTILE_SITE_KEY: z.string().min(1).optional(),
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    // Optional Google Calendar connection (reads when a member is busy; ADR-016). Both OAuth
    // values or neither; with them, CALENDAR_TOKEN_KEY (32 random bytes, base64) is required and
    // seals the stored refresh tokens: `openssl rand -base64 32`.
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    CALENDAR_TOKEN_KEY: z.string().min(1).optional(),
    // Billing is opt-in: with it off, new workspaces are unmetered (no plan limits). With it on, a
    // new workspace starts a trial on the trial plan for BILLING_TRIAL_DAYS days.
    BILLING_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    BILLING_TRIAL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    // Comma-separated emails of platform operators who may open /admin (cross-tenant by design).
    // They must still sign in with a verified email. Empty: nobody can.
    PLATFORM_ADMIN_EMAILS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .refine((value) => Boolean(value.TURNSTILE_SITE_KEY) === Boolean(value.TURNSTILE_SECRET_KEY), {
    message: "TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be set together",
    path: ["TURNSTILE_SITE_KEY"],
  })
  .refine((value) => Boolean(value.GOOGLE_CLIENT_ID) === Boolean(value.GOOGLE_CLIENT_SECRET), {
    message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together",
    path: ["GOOGLE_CLIENT_ID"],
  })
  .refine((value) => !value.GOOGLE_CLIENT_ID || Boolean(value.CALENDAR_TOKEN_KEY), {
    message: "CALENDAR_TOKEN_KEY is required when Google Calendar is configured",
    path: ["CALENDAR_TOKEN_KEY"],
  })
  .refine(
    (value) => !value.CALENDAR_TOKEN_KEY || Boolean(parseSecretKey(value.CALENDAR_TOKEN_KEY)),
    {
      message: "CALENDAR_TOKEN_KEY must be 32 random bytes, base64-encoded",
      path: ["CALENDAR_TOKEN_KEY"],
    },
  );

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated server environment. Throws on first access when configuration is invalid. */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server environment configuration: ${fields}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.EMAIL_TRANSPORT === "log") {
    throw new Error("EMAIL_TRANSPORT=log is not allowed in production");
  }
  cached = parsed.data;
  return cached;
}
