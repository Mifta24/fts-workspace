/**
 * Realtime gateway process: `pnpm gateway`.
 * Environment: DATABASE_URL, APP_URL (the Next.js app, used to verify sessions),
 * REALTIME_PUBLISH_SECRET (shared with the app), GATEWAY_PORT (default 4000),
 * ALLOWED_ORIGIN (default APP_URL).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createGateway } from "./server";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const appUrl = required("APP_URL").replace(/\/+$/, "");
const publishSecret = required("REALTIME_PUBLISH_SECRET");
if (publishSecret.length < 32)
  throw new Error("REALTIME_PUBLISH_SECRET must be at least 32 characters");
const port = Number(process.env.GATEWAY_PORT ?? 4000);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: required("DATABASE_URL") }),
});

const gateway = createGateway({
  prisma,
  publishSecret,
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? appUrl,
  // The app owns session verification (Better Auth); the gateway only forwards the cookie.
  async resolveSession(headers) {
    const cookie = headers.cookie;
    if (!cookie) return null;
    const response = await fetch(`${appUrl}/api/realtime/session`, {
      headers: { cookie },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { userId?: unknown };
    return typeof body.userId === "string" ? body.userId : null;
  },
  log: (message, fields) =>
    console.log(JSON.stringify({ service: "fts-gateway", message, ...fields })),
});

const bound = await gateway.listen(port, process.env.GATEWAY_HOST ?? "0.0.0.0");
console.log(JSON.stringify({ service: "fts-gateway", message: "listening", port: bound }));

async function shutdown() {
  await gateway.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
