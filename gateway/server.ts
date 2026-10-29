import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { PrismaClient } from "../src/generated/prisma/client";
import { canReadChannel, resolveActiveOrganization } from "../src/server/realtime/authorize";
import {
  channelRoom,
  joinChannelSchema,
  publishEventSchema,
  subscribeSchema,
  userRoom,
} from "../src/server/realtime/protocol";

export type GatewayOptions = {
  prisma: Pick<PrismaClient, "member" | "channelMember">;
  /** Returns the verified user id for the handshake headers, or null. */
  resolveSession: (headers: IncomingMessage["headers"]) => Promise<string | null>;
  /** Shared secret the app presents on /internal/publish. */
  publishSecret: string;
  /** The only browser origin allowed to connect. */
  allowedOrigin: string;
  /** How often established sockets are re-checked against the database. */
  revalidateEveryMs?: number;
  log?: (message: string, fields?: Record<string, unknown>) => void;
};

type Grants = {
  userId: string;
  /** slug → organization id the socket subscribed to */
  organizations: Map<string, string>;
  /** room name → check that must keep passing */
  channels: Map<string, { organizationId: string; channelId: string }>;
};

const MAX_CHANNELS_PER_SOCKET = 50;
const MAX_ORGS_PER_SOCKET = 10;
const MAX_ACTIONS_PER_MINUTE = 60;
const MAX_PUBLISH_BYTES = 4096;

export function createGateway(options: GatewayOptions) {
  const log = options.log ?? (() => {});
  const grants = new WeakMap<Socket, Grants>();
  // Session lookups are remote; allowRequest resolves once and the middleware reuses the answer.
  const resolved = new WeakMap<IncomingMessage, string>();

  const httpServer: HttpServer = createServer((req, res) => {
    void handleHttp(req, res);
  });
  const io = new Server(httpServer, {
    cors: { origin: options.allowedOrigin, credentials: true },
    maxHttpBufferSize: 10_000,
    // The cookie-based handshake is the only supported way in.
    allowRequest: (req, callback) => {
      options
        .resolveSession(req.headers)
        .then((userId) => {
          if (userId) resolved.set(req, userId);
          callback(null, userId !== null);
        })
        .catch(() => callback(null, false));
    },
  });

  // Identify the user once per connection, from the verified session; clients never state who they are.
  io.use(async (socket, next) => {
    try {
      const userId =
        resolved.get(socket.request) ?? (await options.resolveSession(socket.request.headers));
      if (!userId) return next(new Error("unauthorized"));
      grants.set(socket, { userId, organizations: new Map(), channels: new Map() });
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const state = grants.get(socket)!;
    let actions = 0;
    const window = setInterval(() => (actions = 0), 60_000);
    window.unref();
    const allowed = () => ++actions <= MAX_ACTIONS_PER_MINUTE;

    socket.on("subscribe", async (payload: unknown, ack?: (result: { ok: boolean }) => void) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const parsed = subscribeSchema.safeParse(payload);
      if (!parsed.success || !allowed()) return reply({ ok: false });
      if (state.organizations.size >= MAX_ORGS_PER_SOCKET) return reply({ ok: false });
      const organizationId = await resolveActiveOrganization(
        options.prisma,
        state.userId,
        parsed.data.organizationSlug,
      );
      if (!organizationId) return reply({ ok: false });
      state.organizations.set(parsed.data.organizationSlug.toLowerCase(), organizationId);
      await socket.join(userRoom(organizationId, state.userId));
      reply({ ok: true });
    });

    socket.on("join", async (payload: unknown, ack?: (result: { ok: boolean }) => void) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const parsed = joinChannelSchema.safeParse(payload);
      if (!parsed.success || !allowed()) return reply({ ok: false });
      if (state.channels.size >= MAX_CHANNELS_PER_SOCKET) return reply({ ok: false });
      const organizationId = await resolveActiveOrganization(
        options.prisma,
        state.userId,
        parsed.data.organizationSlug,
      );
      // Same answer for "no such channel", "not a member" and "no such organization".
      if (
        !organizationId ||
        !(await canReadChannel(options.prisma, state.userId, organizationId, parsed.data.channelId))
      ) {
        return reply({ ok: false });
      }
      const room = channelRoom(organizationId, parsed.data.channelId);
      state.channels.set(room, { organizationId, channelId: parsed.data.channelId });
      await socket.join(room);
      reply({ ok: true });
    });

    socket.on("leave", (payload: unknown) => {
      const parsed = joinChannelSchema.safeParse(payload);
      if (!parsed.success) return;
      for (const [room, grant] of state.channels) {
        if (grant.channelId === parsed.data.channelId) {
          state.channels.delete(room);
          void socket.leave(room);
        }
      }
    });

    socket.on("disconnect", () => clearInterval(window));
  });

  /** Drops rooms whose membership was revoked, and disconnects sockets that lost every organization. */
  async function revalidate(): Promise<void> {
    for (const socket of io.sockets.sockets.values()) {
      const state = grants.get(socket);
      if (!state) continue;
      for (const [slug, organizationId] of state.organizations) {
        const current = await resolveActiveOrganization(options.prisma, state.userId, slug);
        if (current !== organizationId) {
          state.organizations.delete(slug);
          await socket.leave(userRoom(organizationId, state.userId));
          for (const [room, grant] of state.channels) {
            if (grant.organizationId === organizationId) {
              state.channels.delete(room);
              await socket.leave(room);
            }
          }
          socket.emit("revoked", { scope: "organization" });
        }
      }
      for (const [room, grant] of state.channels) {
        const ok = await canReadChannel(
          options.prisma,
          state.userId,
          grant.organizationId,
          grant.channelId,
        );
        if (!ok) {
          state.channels.delete(room);
          await socket.leave(room);
          socket.emit("revoked", { scope: "channel", channelId: grant.channelId });
        }
      }
    }
  }
  const timer = setInterval(() => {
    revalidate().catch((error: unknown) => log("revalidate failed", { error: String(error) }));
  }, options.revalidateEveryMs ?? 60_000);
  timer.unref();

  async function handleHttp(req: IncomingMessage, res: import("node:http").ServerResponse) {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
      return;
    }
    if (req.method === "POST" && url === "/internal/publish") {
      if (!secretMatches(req.headers["x-realtime-secret"], options.publishSecret)) {
        res.writeHead(401).end();
        return;
      }
      const body = await readBody(req, MAX_PUBLISH_BYTES);
      const event = body === null ? null : publishEventSchema.safeParse(safeJson(body));
      if (!event?.success) {
        res.writeHead(400).end();
        return;
      }
      const data = event.data;
      if (data.type === "notification.created") {
        io.to(userRoom(data.organizationId, data.userId)).emit(data.type, {
          notificationId: data.notificationId,
        });
      } else {
        io.to(channelRoom(data.organizationId, data.channelId)).emit(data.type, {
          channelId: data.channelId,
          messageId: data.messageId,
        });
      }
      res.writeHead(204).end();
      return;
    }
    // Socket.IO's own handler serves /socket.io; everything else is unknown.
    if (!url.startsWith("/socket.io")) res.writeHead(404).end();
  }

  return {
    httpServer,
    io,
    revalidate,
    async listen(port: number, host = "127.0.0.1"): Promise<number> {
      await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
      const address = httpServer.address();
      return typeof address === "object" && address ? address.port : port;
    },
    async close(): Promise<void> {
      clearInterval(timer);
      await io.close();
    },
  };
}

function secretMatches(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
