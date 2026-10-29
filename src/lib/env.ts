import "server-only";
import { z } from "zod";

const envSchema = z.object({
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
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

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
