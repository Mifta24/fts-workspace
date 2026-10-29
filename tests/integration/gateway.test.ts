import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { createGateway } from "../../gateway/server";
import {
  createChannel,
  joinChannel,
  postMessage,
  startDirectMessage,
} from "@/features/chat/server/chat-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { createTask } from "@/features/tasks/server/task-service";
import { db } from "@/lib/db";
import { setRealtimePublisher, type RealtimeEvent } from "@/server/realtime/publisher";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const SECRET = "test-publish-secret-0123456789abcdef";
const ORIGIN = "http://localhost:3000";
const deps = () => ({ prisma: db() });

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });

let gateway: ReturnType<typeof createGateway>;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  gateway = createGateway({
    prisma: db(),
    publishSecret: SECRET,
    allowedOrigin: ORIGIN,
    // Tests identify the user with a header instead of a Better Auth cookie.
    resolveSession: async (headers) => {
      const value = headers["x-test-user"];
      return typeof value === "string" ? value : null;
    },
    revalidateEveryMs: 3_600_000,
  });
  url = `http://127.0.0.1:${await gateway.listen(0)}`;
});

afterAll(async () => {
  await gateway.close();
});

afterEach(() => {
  while (sockets.length) sockets.pop()!.disconnect();
  setRealtimePublisher(null);
});

async function open(userId: string | null): Promise<Socket> {
  const socket = connect(url, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: userId ? { "x-test-user": userId } : {},
    forceNew: true,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (error) => reject(error));
  });
  return socket;
}

const ask = <T>(socket: Socket, event: string, payload: unknown) =>
  socket.timeout(3000).emitWithAck(event, payload) as Promise<T>;

function nextEvent(socket: Socket, event: string, ms = 1500): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Resolves true when no such event arrives in the window. */
const stays = (socket: Socket, event: string, ms = 400) =>
  nextEvent(socket, event, ms).then(
    () => false,
    () => true,
  );

async function publish(body: unknown, secret: string | null = SECRET) {
  return fetch(`${url}/internal/publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-realtime-secret": secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function setup() {
  const acme = await createTestOrganization("acme", {
    alice: "MEMBER",
    bob: "MEMBER",
    carol: "MEMBER",
  });
  const globex = await createTestOrganization("globex");
  const alice = await contextFor("acme", acme.users.alice!.id);
  const bob = await contextFor("acme", acme.users.bob!.id);
  const carol = await contextFor("acme", acme.users.carol!.id);
  const owner = await contextFor("acme", acme.users.owner!.id);
  const globexOwner = await contextFor("globex", globex.users.owner!.id);
  return { acme, globex, alice, bob, carol, owner, globexOwner };
}

describe("realtime gateway", () => {
  beforeEach(resetDatabase);

  it("rejects connections without a verified session", async () => {
    await expect(open(null)).rejects.toBeDefined();
  });

  it("only subscribes users to organizations where they are active members", async () => {
    const { alice, globexOwner } = await setup();
    const socket = await open(alice.userId);
    expect(await ask(socket, "subscribe", { organizationSlug: "acme" })).toEqual({ ok: true });
    expect(await ask(socket, "subscribe", { organizationSlug: "globex" })).toEqual({ ok: false });
    expect(await ask(socket, "subscribe", { organizationSlug: "nope-nope" })).toEqual({
      ok: false,
    });
    expect(await ask(socket, "subscribe", { organizationSlug: 42 })).toEqual({ ok: false });
    expect(globexOwner.userId).not.toBe(alice.userId);
  });

  it("authorizes every channel join against channel membership", async () => {
    const { alice, bob, carol, owner, globexOwner } = await setup();
    const open$ = await createChannel(deps(), owner, { name: "town-square", isPrivate: false });
    const secret = await createChannel(deps(), owner, { name: "leadership", isPrivate: true });
    const dm = await startDirectMessage(deps(), alice, bob.userId);
    const foreign = await createChannel(deps(), globexOwner, { name: "secrets", isPrivate: false });
    await joinChannel(deps(), alice, open$.id);

    const a = await open(alice.userId);
    const join = (channelId: string, slug = "acme") =>
      ask(a, "join", { organizationSlug: slug, channelId });
    expect(await join(open$.id)).toEqual({ ok: true });
    expect(await join(dm.id)).toEqual({ ok: true });
    // Everything else gets the same answer: not a member, private, other tenant, malformed.
    expect(await join(secret.id)).toEqual({ ok: false });
    expect(await join(foreign.id)).toEqual({ ok: false });
    expect(await join(foreign.id, "globex")).toEqual({ ok: false });
    expect(await join("not-a-uuid")).toEqual({ ok: false });

    const c = await open(carol.userId);
    expect(await ask(c, "join", { organizationSlug: "acme", channelId: dm.id })).toEqual({
      ok: false,
    });
    expect(await ask(c, "join", { organizationSlug: "acme", channelId: open$.id })).toEqual({
      ok: false,
    });
  });

  it("delivers message events only to the channel's joined members, as identifiers", async () => {
    const { alice, bob, carol, owner } = await setup();
    const dm = await startDirectMessage(deps(), alice, bob.userId);
    const a = await open(alice.userId);
    const b = await open(bob.userId);
    const c = await open(carol.userId);
    for (const [socket, id] of [
      [a, dm.id],
      [b, dm.id],
    ] as const) {
      await ask(socket, "join", { organizationSlug: "acme", channelId: id });
    }
    await ask(c, "subscribe", { organizationSlug: "acme" });
    expect(await ask(c, "join", { organizationSlug: "acme", channelId: dm.id })).toEqual({
      ok: false,
    });

    const gotA = nextEvent(a, "message.created");
    const gotB = nextEvent(b, "message.created");
    const noC = stays(c, "message.created");
    // Wire the app's publisher straight to the gateway, as REALTIME_URL does in production.
    setRealtimePublisher(async (event: RealtimeEvent) => {
      const response = await publish(event);
      if (!response.ok) throw new Error("publish failed");
    });
    const message = await postMessage(deps(), alice, dm.id, { body: "highly confidential text" });

    expect(await gotA).toEqual({ channelId: dm.id, messageId: message.id });
    expect(await gotB).toEqual({ channelId: dm.id, messageId: message.id });
    expect(await noC).toBe(true);
    expect(owner.userId).toBeTruthy();
  });

  it("delivers notification events only to the notified user", async () => {
    const { alice, bob, owner } = await setup();
    const a = await open(alice.userId);
    const b = await open(bob.userId);
    await ask(a, "subscribe", { organizationSlug: "acme" });
    await ask(b, "subscribe", { organizationSlug: "acme" });

    const gotA = nextEvent(a, "notification.created");
    const noB = stays(b, "notification.created");
    setRealtimePublisher(async (event) => {
      await publish(event);
    });
    await createTask(deps(), owner, { title: "Assigned", assigneeId: alice.userId });
    expect(await gotA).toMatchObject({ notificationId: expect.any(String) });
    expect(await noB).toBe(true);
  });

  it("protects the publish endpoint", async () => {
    const event = {
      type: "message.created",
      organizationId: crypto.randomUUID(),
      channelId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
    };
    expect((await publish(event, null)).status).toBe(401);
    expect((await publish(event, "wrong-secret-wrong-secret-wrong-1234")).status).toBe(401);
    expect((await publish({ ...event, type: "message.deleted" })).status).toBe(400);
    expect((await publish({ type: "message.created", body: "text" })).status).toBe(400);
    expect((await publish(event)).status).toBe(204);
    const huge = await publish({ ...event, padding: "x".repeat(10_000) });
    expect(huge.status).toBe(400);
  });

  it("revokes live access when a membership is disabled or a channel membership is removed", async () => {
    const { alice, bob, acme, owner } = await setup();
    const room = await createChannel(deps(), owner, { name: "ops", isPrivate: false });
    await joinChannel(deps(), alice, room.id);
    await joinChannel(deps(), bob, room.id);

    const a = await open(alice.userId);
    const b = await open(bob.userId);
    for (const socket of [a, b]) {
      await ask(socket, "subscribe", { organizationSlug: "acme" });
      expect(await ask(socket, "join", { organizationSlug: "acme", channelId: room.id })).toEqual({
        ok: true,
      });
    }

    // Bob leaves the channel; Alice's organization membership is disabled.
    await db().channelMember.deleteMany({ where: { channelId: room.id, userId: bob.userId } });
    await db().member.update({
      where: {
        organizationId_userId: { organizationId: acme.organization.id, userId: alice.userId },
      },
      data: { status: "DISABLED" },
    });
    const revokedA = nextEvent(a, "revoked");
    const revokedB = nextEvent(b, "revoked");
    await gateway.revalidate();
    expect(await revokedA).toMatchObject({ scope: "organization" });
    expect(await revokedB).toMatchObject({ scope: "channel", channelId: room.id });

    const noA = stays(a, "message.created");
    const noB = stays(b, "message.created");
    await publish({
      type: "message.created",
      organizationId: acme.organization.id,
      channelId: room.id,
      messageId: crypto.randomUUID(),
    });
    expect(await noA).toBe(true);
    expect(await noB).toBe(true);
  });

  it("a failing gateway never breaks the app request", async () => {
    const { alice, bob } = await setup();
    const dm = await startDirectMessage(deps(), alice, bob.userId);
    setRealtimePublisher(async () => {
      throw new Error("gateway unreachable");
    });
    await expect(
      postMessage(deps(), alice, dm.id, { body: "still delivered to the database" }),
    ).resolves.toBeDefined();
  });
});
