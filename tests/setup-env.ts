import { inject } from "vitest";

process.env.DATABASE_URL = inject("databaseUrl");
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-0123456789abcdefghijklmnop";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.EMAIL_TRANSPORT = "log";
process.env.LOG_LEVEL = "silent";
