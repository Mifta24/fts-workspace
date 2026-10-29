import { beforeEach, describe, expect, it } from "vitest";
import { postMessage, startDirectMessage } from "@/features/chat/server/chat-service";
import {
  countUnread,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/features/notifications/server/notification-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { addComment, createTask, updateTask } from "@/features/tasks/server/task-service";
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
  const acme = await createTestOrganization("acme", { alice: "MEMBER", bob: "MEMBER" });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    owner: await contextFor("acme", acme.users.owner!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    bob: await contextFor("acme", acme.users.bob!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

describe("notifications", () => {
  beforeEach(async () => {
    await resetDatabase();
    setRealtimePublisher(null);
  });

  it("notifies an assignee on create and on reassignment, but never about one's own actions", async () => {
    const { owner, alice, bob } = await setup();
    const task = await createTask(deps(), owner, {
      title: "Write report",
      assigneeId: alice.userId,
    });
    expect(await countUnread(deps(), alice)).toBe(1);
    expect(await countUnread(deps(), owner)).toBe(0);

    const [item] = await listNotifications(deps(), alice);
    expect(item).toMatchObject({
      type: "TASK_ASSIGNED",
      resourceId: task.id,
      resourceTitle: "Write report",
      actorName: "Test acme-owner",
      read: false,
    });

    await updateTask(deps(), owner, task.id, { assigneeId: bob.userId });
    expect(await countUnread(deps(), bob)).toBe(1);
    // Assigning yourself is not news.
    const own = await createTask(deps(), alice, { title: "Mine", assigneeId: alice.userId });
    expect(own).toBeDefined();
    expect(await countUnread(deps(), alice)).toBe(1);
  });

  it("notifies the assignee and creator about comments from someone else", async () => {
    const { owner, alice, bob } = await setup();
    const task = await createTask(deps(), owner, { title: "Discuss", assigneeId: alice.userId });
    await addComment(deps(), bob, task.id, { body: "thoughts?" });
    expect(await countUnread(deps(), owner)).toBe(1);
    // alice has the assignment plus the comment: two different types.
    expect(await countUnread(deps(), alice)).toBe(2);
    expect(await countUnread(deps(), bob)).toBe(0);
    await addComment(deps(), owner, task.id, { body: "replying" });
    expect(await countUnread(deps(), owner)).toBe(1);
  });

  it("coalesces repeated direct-message notifications until they are read", async () => {
    const { alice, bob } = await setup();
    const dm = await startDirectMessage(deps(), alice, bob.userId);
    await postMessage(deps(), alice, dm.id, { body: "one" });
    await postMessage(deps(), alice, dm.id, { body: "two" });
    expect(await countUnread(deps(), bob)).toBe(1);
    expect(await countUnread(deps(), alice)).toBe(0);
    const [item] = await listNotifications(deps(), bob);
    await markNotificationRead(deps(), bob, item!.id);
    await postMessage(deps(), alice, dm.id, { body: "three" });
    expect(await countUnread(deps(), bob)).toBe(1);
  });

  it("marks one or all as read, only for the owner", async () => {
    const { owner, alice, bob } = await setup();
    await createTask(deps(), owner, { title: "One", assigneeId: alice.userId });
    await createTask(deps(), owner, { title: "Two", assigneeId: alice.userId });
    const items = await listNotifications(deps(), alice);
    await expectCode(markNotificationRead(deps(), bob, items[0]!.id), "NOT_FOUND");
    expect(await countUnread(deps(), alice)).toBe(2);
    await markNotificationRead(deps(), alice, items[0]!.id);
    expect(await countUnread(deps(), alice)).toBe(1);
    expect(await markAllNotificationsRead(deps(), alice)).toBe(1);
    expect(await listNotifications(deps(), alice, { unreadOnly: true })).toEqual([]);
  });

  it("does not notify people who are not active members", async () => {
    const { owner, alice, acme } = await setup();
    await db().member.update({
      where: {
        organizationId_userId: { organizationId: acme.organization.id, userId: alice.userId },
      },
      data: { status: "DISABLED" },
    });
    await expect(
      createTask(deps(), owner, { title: "Orphan", assigneeId: alice.userId }),
    ).rejects.toBeInstanceOf(AppError);
    expect(await db().notification.count()).toBe(0);
  });

  it("publishes notification identifiers after commit", async () => {
    const { owner, alice } = await setup();
    const events: RealtimeEvent[] = [];
    setRealtimePublisher(async (event) => {
      events.push(event);
    });
    await createTask(deps(), owner, { title: "Evented", assigneeId: alice.userId });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "notification.created", userId: alice.userId });
    expect(JSON.stringify(events)).not.toContain("Evented");
    setRealtimePublisher(null);
  });

  describe("tenant isolation", () => {
    it("never shows or modifies another organization's or another user's notifications", async () => {
      const { owner, alice, globexOwner } = await setup();
      await createTask(deps(), owner, { title: "For alice", assigneeId: alice.userId });
      const [mine] = await listNotifications(deps(), alice);

      expect(await listNotifications(deps(), globexOwner)).toEqual([]);
      expect(await countUnread(deps(), globexOwner)).toBe(0);
      await expectCode(markNotificationRead(deps(), globexOwner, mine!.id), "NOT_FOUND");
      expect(await markAllNotificationsRead(deps(), globexOwner)).toBe(0);
      expect(await countUnread(deps(), alice)).toBe(1);
    });
  });
});
