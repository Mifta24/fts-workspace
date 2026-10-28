import "server-only";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  EMAIL_TRANSPORT: z.enum(["log"]).default("log"),
  EMAIL_FROM: z.string().min(1).default("FTS Workspace <no-reply@localhost>"),
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
