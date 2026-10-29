/**
 * Load test for message delivery through the gateway: `pnpm test:load`
 *   CLIENTS (default 500) sockets in one channel, EVENTS (default 200) published at RATE per second.
 * Runs in a single process against an embedded PostgreSQL, so the numbers are a floor for one
 * machine, not a capacity statement. Exits non-zero if delivery is incomplete or slow.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { execFileSync } from "node:child_process";
import { io as connect, type Socket } from "socket.io-client";
import { createGateway } from "../gateway/server";
import { PrismaClient } from "../src/generated/prisma/client";
import { startLocalPostgres } from "./local-postgres";

const CLIENTS = Number(process.env.CLIENTS ?? 500);
const EVENTS = Number(process.env.EVENTS ?? 200);
const RATE = Number(process.env.RATE ?? 50);
const SECRET = "load-test-secret-0123456789abcdefghij";
const P95_BUDGET_MS = Number(process.env.P95_BUDGET_MS ?? 1000);

const database = await startLocalPostgres({
  dataDir: ".data/postgres-load",
  port: 54331,
  persistent: false,
  password: "fts_load_password",
});
await database.ensureDatabase("fts_workspace_load");
const url = database.urlFor("fts_workspace_load");
execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: url },
  stdio: "pipe",
});
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
// A previous aborted run may have left rows behind.
await prisma.$executeRawUnsafe('TRUNCATE TABLE "users", "organizations" RESTART IDENTITY CASCADE');

const userIds = Array.from({ length: CLIENTS }, () => crypto.randomUUID());
await prisma.user.createMany({
  data: userIds.map((id, i) => ({
    id,
    name: `Load ${i}`,
    email: `load-${i}@example.test`,
    emailVerified: true,
  })),
});
const organization = await prisma.organization.create({
  data: { name: "Load", slug: "load-test" },
});
await prisma.member.createMany({
  data: userIds.map((userId) => ({
    organizationId: organization.id,
    userId,
    role: "MEMBER" as const,
  })),
});
const channel = await prisma.channel.create({
  data: {
    organizationId: organization.id,
    name: "load",
    createdById: userIds[0]!,
    type: "CHANNEL",
  },
});
await prisma.channelMember.createMany({
  data: userIds.map((userId) => ({
    organizationId: organization.id,
    channelId: channel.id,
    userId,
  })),
});

const gateway = createGateway({
  prisma,
  publishSecret: SECRET,
  allowedOrigin: "http://localhost:3000",
  resolveSession: async (headers) =>
    typeof headers["x-test-user"] === "string" ? headers["x-test-user"] : null,
});
const port = await gateway.listen(0);
const base = `http://127.0.0.1:${port}`;

const sockets: Socket[] = [];
const connectStart = performance.now();
const BATCH = 100;
async function attach(userId: string) {
  const socket = connect(base, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    extraHeaders: { "x-test-user": userId },
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  const joined = (await socket.timeout(10_000).emitWithAck("join", {
    organizationSlug: "load-test",
    channelId: channel.id,
  })) as { ok: boolean };
  if (!joined.ok) throw new Error("join was refused");
}
// Connect in batches: a burst of thousands of simultaneous handshakes measures the OS accept
// queue of a single test process, not message delivery.
for (let i = 0; i < userIds.length; i += BATCH) {
  await Promise.all(userIds.slice(i, i + BATCH).map(attach));
}
const connectMs = performance.now() - connectStart;

const sentAt = new Map<string, number>();
const latencies: number[] = [];
let received = 0;
for (const socket of sockets) {
  socket.on("message.created", (event: { messageId: string }) => {
    received += 1;
    const start = sentAt.get(event.messageId);
    if (start !== undefined) latencies.push(performance.now() - start);
  });
}

const publishStart = performance.now();
for (let i = 0; i < EVENTS; i++) {
  const messageId = crypto.randomUUID();
  sentAt.set(messageId, performance.now());
  const response = await fetch(`${base}/internal/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-realtime-secret": SECRET },
    body: JSON.stringify({
      type: "message.created",
      organizationId: organization.id,
      channelId: channel.id,
      messageId,
    }),
  });
  if (response.status !== 204) throw new Error(`publish answered ${response.status}`);
  await new Promise((resolve) => setTimeout(resolve, 1000 / RATE));
}
const expected = EVENTS * CLIENTS;
const deadline = Date.now() + 15_000;
while (received < expected && Date.now() < deadline)
  await new Promise((resolve) => setTimeout(resolve, 50));
const publishMs = performance.now() - publishStart;

latencies.sort((a, b) => a - b);
const at = (q: number) =>
  latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] ?? NaN;
const result = {
  clients: CLIENTS,
  events: EVENTS,
  ratePerSecond: RATE,
  connectAndJoinMs: Math.round(connectMs),
  expectedDeliveries: expected,
  receivedDeliveries: received,
  lossPercent: Number((((expected - received) / expected) * 100).toFixed(3)),
  latencyMs: {
    p50: Math.round(at(0.5)),
    p95: Math.round(at(0.95)),
    p99: Math.round(at(0.99)),
    max: Math.round(latencies.at(-1) ?? NaN),
  },
  totalMs: Math.round(publishMs),
};
console.log(JSON.stringify(result, null, 2));

for (const socket of sockets) socket.disconnect();
await gateway.close();
await prisma.$disconnect();
await database.stop();

if (received < expected || at(0.95) > P95_BUDGET_MS) {
  console.error("Load test failed: incomplete delivery or p95 above budget");
  process.exit(1);
}
process.exit(0);
