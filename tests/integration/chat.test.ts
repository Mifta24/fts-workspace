import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addChannelMember,
  createChannel,
  deleteMessage,
  editMessage,
  getMessage,
  joinChannel,
  listChannels,
  listMessages,
  markChannelRead,
  postMessage,
  startDirectMessage,
} from "@/features/chat/server/chat-service";
import { EDIT_WINDOW_MS, MESSAGES_PER_MINUTE } from "@/features/chat/schemas/chat";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { setRealtimePublisher, type RealtimeEvent } from "@/server/realtime/publisher";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });

async function setup() {
  const acme = await createTestOrganization("acme", {
    admin: "ADMIN",
    manager: "MANAGER",
    member: "MEMBER",
    other: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  const ctx = {
    owner: await contextFor("acme", acme.users.owner!.id),
    admin: await contextFor("acme", acme.users.admin!.id),
    manager: await contextFor("acme", acme.users.manager!.id),
    member: await contextFor("acme", acme.users.member!.id),
    other: await contextFor("acme", acme.users.other!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
  const general = await createChannel(deps(), ctx.manager, { name: "general", isPrivate: false });
  await joinChannel(deps(), ctx.member, general.id);
  await joinChannel(deps(), ctx.admin, general.id);
  await joinChannel(deps(), ctx.viewer, general.id);
  return { acme, globex, ...ctx, general };
}

describe("chat", () => {
  beforeEach(resetDatabase);
  afterEach(() => setRealtimePublisher(null));

  describe("channels", () => {
    it("creates channels for managers, with the creator as the first member", async () => {
      const { manager, member, acme } = await setup();
      await expectCode(
        createChannel(deps(), member, { name: "random", isPrivate: false }),
        "FORBIDDEN",
      );
      await expectCode(
        createChannel(deps(), manager, { name: "General", isPrivate: false }),
        "CONFLICT",
      );
      await expectCode(
        createChannel(deps(), manager, { name: "no spaces", isPrivate: false }),
        "INVALID_INPUT",
      );
      await expectCode(
        createChannel(deps(), manager, { name: "x", isPrivate: false }),
        "INVALID_INPUT",
      );
      const row = await db().channel.findFirstOrThrow({ where: { name: "general" } });
      expect(row.organizationId).toBe(acme.organization.id);
      expect(await db().auditLog.count({ where: { action: "channel.created" } })).toBe(1);
    });

    it("lists joined channels with unread counts and joinable public channels", async () => {
      const { manager, member, other, general } = await setup();
      await postMessage(deps(), manager, general.id, { body: "hello team" });
      await postMessage(deps(), manager, general.id, { body: "second" });

      const { joined } = await listChannels(deps(), member);
      expect(joined.find((c) => c.id === general.id)).toMatchObject({ name: "general", unread: 2 });
      await markChannelRead(deps(), member, general.id);
      expect(
        (await listChannels(deps(), member)).joined.find((c) => c.id === general.id)!.unread,
      ).toBe(0);

      const lists = await listChannels(deps(), other);
      expect(lists.joined).toEqual([]);
      expect(lists.available.map((c) => c.name)).toEqual(["general"]);
    });

    it("lets people join public channels only; private channels and DMs look nonexistent", async () => {
      const { manager, member, other, owner } = await setup();
      const secret = await createChannel(deps(), manager, { name: "leadership", isPrivate: true });
      await expectCode(joinChannel(deps(), member, secret.id), "NOT_FOUND");
      const dm = await startDirectMessage(deps(), owner, member.userId);
      await expectCode(joinChannel(deps(), other, dm.id), "NOT_FOUND");
      expect((await listChannels(deps(), other)).available.map((c) => c.name)).not.toContain(
        "leadership",
      );

      // Managers can invite into a channel they belong to; non-members cannot read it before that.
      await expectCode(listMessages(deps(), member, secret.id), "NOT_FOUND");
      await addChannelMember(deps(), manager, secret.id, member.userId);
      await expect(listMessages(deps(), member, secret.id)).resolves.toBeDefined();
      await expectCode(addChannelMember(deps(), member, secret.id, other.userId), "FORBIDDEN");
      await expectCode(addChannelMember(deps(), manager, dm.id, other.userId), "NOT_FOUND");
    });
  });

  describe("messages", () => {
    it("requires membership and the post permission", async () => {
      const { member, other, viewer, general, manager } = await setup();
      await expectCode(
        postMessage(deps(), other, general.id, { body: "not a member" }),
        "NOT_FOUND",
      );
      await expectCode(listMessages(deps(), other, general.id), "NOT_FOUND");
      await expectCode(postMessage(deps(), viewer, general.id, { body: "viewer" }), "FORBIDDEN");
      const posted = await postMessage(deps(), member, general.id, { body: "  hi there  " });
      expect(posted).toMatchObject({
        body: "hi there",
        edited: false,
        deleted: false,
        editable: true,
      });
      // Viewers can read what others post.
      expect((await listMessages(deps(), viewer, general.id)).messages.map((m) => m.body)).toEqual([
        "hi there",
      ]);
      await expectCode(postMessage(deps(), manager, general.id, { body: "   " }), "INVALID_INPUT");
      await expectCode(
        postMessage(deps(), manager, general.id, { body: "x".repeat(4001) }),
        "INVALID_INPUT",
      );
      await expectCode(postMessage(deps(), manager, "not-a-uuid", { body: "hi" }), "NOT_FOUND");
    });

    it("rate limits each author per minute", async () => {
      const { member, general } = await setup();
      const now = new Date();
      for (let i = 0; i < MESSAGES_PER_MINUTE; i++) {
        await postMessage(deps(), member, general.id, { body: `m${i}` }, now);
      }
      await expectCode(
        postMessage(deps(), member, general.id, { body: "one too many" }, now),
        "RATE_LIMITED",
      );
      const later = new Date(now.getTime() + 61_000);
      await expect(
        postMessage(deps(), member, general.id, { body: "ok again" }, later),
      ).resolves.toBeDefined();
    });

    it("paginates history with a stable cursor in chronological order", async () => {
      const { manager, general } = await setup();
      const base = Date.now() - 60_000;
      for (let i = 1; i <= 5; i++) {
        await db().message.create({
          data: {
            organizationId: manager.organization.id,
            channelId: general.id,
            authorId: manager.userId,
            body: `m${i}`,
            createdAt: new Date(base + i * 1000),
          },
        });
      }
      const first = await listMessages(deps(), manager, general.id, { limit: 2 });
      expect(first.messages.map((m) => m.body)).toEqual(["m4", "m5"]);
      const second = await listMessages(deps(), manager, general.id, {
        limit: 2,
        before: first.messages[0]!.id,
      });
      expect(second.messages.map((m) => m.body)).toEqual(["m2", "m3"]);
      const third = await listMessages(deps(), manager, general.id, {
        limit: 2,
        before: second.messages[0]!.id,
      });
      expect(third.messages.map((m) => m.body)).toEqual(["m1"]);
      expect(third.nextCursor).toBeNull();

      const other = await createChannel(deps(), manager, { name: "other", isPrivate: false });
      await expectCode(
        listMessages(deps(), manager, other.id, { before: first.messages[0]!.id }),
        "INVALID_INPUT",
      );
      await expectCode(listMessages(deps(), manager, general.id, { limit: 1000 }), "INVALID_INPUT");
    });

    it("lets authors edit within 15 minutes only, and nobody else", async () => {
      const { member, manager, general } = await setup();
      const message = await postMessage(deps(), member, general.id, { body: "typo" });
      await editMessage(deps(), member, message.id, { body: "fixed" });
      const edited = (await listMessages(deps(), member, general.id)).messages[0]!;
      expect(edited).toMatchObject({ body: "fixed", edited: true });

      await expectCode(editMessage(deps(), manager, message.id, { body: "hijack" }), "FORBIDDEN");
      const late = new Date(Date.now() + EDIT_WINDOW_MS + 1000);
      await expectCode(
        editMessage(deps(), member, message.id, { body: "too late" }, late),
        "UNPROCESSABLE",
      );
      expect((await getMessage(deps(), member, message.id)).editable).toBe(true);
    });

    it("soft-deletes: authors anywhere they belong, admins in public channels only", async () => {
      const { member, manager, admin, owner, general } = await setup();
      const mine = await postMessage(deps(), member, general.id, { body: "oops" });
      await deleteMessage(deps(), member, mine.id);
      const row = await db().message.findUniqueOrThrow({ where: { id: mine.id } });
      expect(row).toMatchObject({ body: "" });
      expect(row.deletedAt).not.toBeNull();
      expect((await listMessages(deps(), manager, general.id)).messages[0]).toMatchObject({
        deleted: true,
        body: "",
      });
      await expectCode(editMessage(deps(), member, mine.id, { body: "undo" }), "UNPROCESSABLE");

      // Moderation: managers cannot, admins can in public channels.
      const spam = await postMessage(deps(), member, general.id, { body: "spam" });
      await expectCode(deleteMessage(deps(), manager, spam.id), "FORBIDDEN");
      await deleteMessage(deps(), admin, spam.id);
      expect(await db().auditLog.count({ where: { action: "message.deleted" } })).toBe(2);
      const moderated = await db().auditLog.findFirstOrThrow({ where: { resourceId: spam.id } });
      expect(moderated.metadata).toMatchObject({ moderated: true });

      // An admin who is not in a DM cannot moderate it, or even see it.
      const dm = await startDirectMessage(deps(), member, owner.userId);
      const private$ = await postMessage(deps(), member, dm.id, { body: "private chat" });
      await expectCode(deleteMessage(deps(), admin, private$.id), "NOT_FOUND");
      expect(
        (await db().message.findUniqueOrThrow({ where: { id: private$.id } })).deletedAt,
      ).toBeNull();
    });
  });

  describe("direct messages", () => {
    it("creates one DM per pair regardless of who starts it, even concurrently", async () => {
      const { member, other } = await setup();
      const [a, b] = await Promise.all([
        startDirectMessage(deps(), member, other.userId),
        startDirectMessage(deps(), other, member.userId),
      ]);
      expect(a.id).toBe(b.id);
      expect(await db().channel.count({ where: { type: "DM" } })).toBe(1);
      const names = (await listChannels(deps(), member)).joined
        .filter((c) => c.type === "DM")
        .map((c) => c.name);
      expect(names).toEqual(["Test acme-other"]);
    });

    it("keeps DMs private to the two participants", async () => {
      const { member, other, owner, admin } = await setup();
      const dm = await startDirectMessage(deps(), member, other.userId);
      await postMessage(deps(), member, dm.id, { body: "just us" });
      for (const outsider of [owner, admin]) {
        await expectCode(listMessages(deps(), outsider, dm.id), "NOT_FOUND");
        await expectCode(postMessage(deps(), outsider, dm.id, { body: "intrude" }), "NOT_FOUND");
      }
      expect((await listMessages(deps(), other, dm.id)).messages).toHaveLength(1);
    });

    it("rejects self, unknown, disabled and other-organization users", async () => {
      const { member, viewer, globex, acme } = await setup();
      await expectCode(startDirectMessage(deps(), member, member.userId), "INVALID_INPUT");
      await expectCode(startDirectMessage(deps(), member, "nope"), "INVALID_INPUT");
      await expectCode(startDirectMessage(deps(), member, globex.users.owner!.id), "UNPROCESSABLE");
      await db().member.update({
        where: {
          organizationId_userId: {
            organizationId: acme.organization.id,
            userId: acme.users.other!.id,
          },
        },
        data: { status: "DISABLED" },
      });
      await expectCode(startDirectMessage(deps(), member, acme.users.other!.id), "UNPROCESSABLE");
      await expectCode(startDirectMessage(deps(), viewer, member.userId), "FORBIDDEN");
    });
  });

  describe("realtime events", () => {
    it("publishes identifiers only, and a failing transport never fails the request", async () => {
      const { member, general } = await setup();
      const events: RealtimeEvent[] = [];
      setRealtimePublisher(async (event) => {
        events.push(event);
      });
      const message = await postMessage(deps(), member, general.id, { body: "top secret text" });
      expect(events).toEqual([
        {
          type: "message.created",
          organizationId: member.organization.id,
          channelId: general.id,
          messageId: message.id,
        },
      ]);
      expect(JSON.stringify(events)).not.toContain("top secret");

      setRealtimePublisher(vi.fn().mockRejectedValue(new Error("gateway down")));
      await expect(
        postMessage(deps(), member, general.id, { body: "still works" }),
      ).resolves.toBeDefined();
    });
  });

  describe("tenant isolation", () => {
    it("treats another organization's channels and messages as nonexistent", async () => {
      const { globexOwner, member, general } = await setup();
      const foreign = await createChannel(deps(), globexOwner, {
        name: "secrets",
        isPrivate: false,
      });
      const foreignMessage = await postMessage(deps(), globexOwner, foreign.id, {
        body: "globex only",
      });

      expect((await listChannels(deps(), member)).available.map((c) => c.name)).not.toContain(
        "secrets",
      );
      await expectCode(joinChannel(deps(), member, foreign.id), "NOT_FOUND");
      await expectCode(listMessages(deps(), member, foreign.id), "NOT_FOUND");
      await expectCode(postMessage(deps(), member, foreign.id, { body: "inject" }), "NOT_FOUND");
      await expectCode(getMessage(deps(), member, foreignMessage.id), "NOT_FOUND");
      await expectCode(editMessage(deps(), member, foreignMessage.id, { body: "x" }), "NOT_FOUND");
      await expectCode(deleteMessage(deps(), member, foreignMessage.id), "NOT_FOUND");
      await expectCode(
        listMessages(deps(), member, general.id, { before: foreignMessage.id }),
        "INVALID_INPUT",
      );
      expect(await db().message.count({ where: { channelId: foreign.id } })).toBe(1);
    });

    it("rejects cross-tenant memberships and messages at the database level", async () => {
      const { globexOwner, member, acme } = await setup();
      const foreign = await createChannel(deps(), globexOwner, {
        name: "secrets",
        isPrivate: false,
      });
      await expect(
        db().channelMember.create({
          data: {
            organizationId: acme.organization.id,
            channelId: foreign.id,
            userId: member.userId,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db().message.create({
          data: {
            organizationId: acme.organization.id,
            channelId: foreign.id,
            authorId: member.userId,
            body: "x",
          },
        }),
      ).rejects.toThrow();
    });
  });
});
