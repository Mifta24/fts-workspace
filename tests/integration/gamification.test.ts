import { beforeEach, describe, expect, it } from "vitest";
import {
  archiveChallenge,
  createChallenge,
  getLeaderboard,
  getMyStats,
  listChallenges,
  setLeaderboardOptIn,
  setLeaderboardVisibility,
} from "@/features/gamification/server/gamification-service";
import { DAILY_AWARD_CAP } from "@/features/gamification/schemas/gamification";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { createTask, updateTask } from "@/features/tasks/server/task-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const DAY = 86_400_000;

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
    alice: "MEMBER",
    bob: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    owner: await contextFor("acme", acme.users.owner!.id),
    admin: await contextFor("acme", acme.users.admin!.id),
    manager: await contextFor("acme", acme.users.manager!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    bob: await contextFor("acme", acme.users.bob!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

/** An owner-created task assigned to `assignee`, completed by `completer`. */
async function completeTask(
  creator: OrganizationContext,
  assigneeId: string,
  completer: OrganizationContext,
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" = "MEDIUM",
) {
  const task = await createTask(deps(), creator, {
    title: `Task ${crypto.randomUUID().slice(0, 6)}`,
    assigneeId,
    priority,
  });
  await updateTask(deps(), completer, task.id, { status: "COMPLETED" });
  return task;
}

const events = (userId: string) => db().pointEvent.findMany({ where: { userId } });

describe("points ledger", () => {
  beforeEach(resetDatabase);

  it("awards the assignee for finishing a task assigned by someone else, by priority", async () => {
    const { owner, alice } = await setup();
    await completeTask(owner, alice.userId, alice, "HIGH");
    const [event] = await events(alice.userId);
    expect(event).toMatchObject({ points: 15, type: "TASK_COMPLETED", sourceType: "task" });
    expect((await getMyStats(deps(), alice)).totalPoints).toBe(15);
  });

  it("awards nothing to someone who completes another person's task, or an unassigned one", async () => {
    const { owner, alice, manager } = await setup();
    await completeTask(owner, alice.userId, manager);
    const unassigned = await createTask(deps(), owner, { title: "Nobody's task" });
    await updateTask(deps(), alice, unassigned.id, { status: "COMPLETED" });
    expect(await db().pointEvent.count()).toBe(0);
  });

  it("does not pay for tasks you create and finish within 10 minutes, but does for older ones", async () => {
    const { alice } = await setup();
    const quick = await createTask(deps(), alice, { title: "Self made", assigneeId: alice.userId });
    await updateTask(deps(), alice, quick.id, { status: "COMPLETED" });
    expect(await db().pointEvent.count()).toBe(0);

    const older = await createTask(deps(), alice, {
      title: "Self made, older",
      assigneeId: alice.userId,
    });
    await db().task.update({
      where: { id: older.id },
      data: { createdAt: new Date(Date.now() - 20 * 60_000) },
    });
    await updateTask(deps(), alice, older.id, { status: "COMPLETED" });
    expect(await db().pointEvent.count()).toBe(1);
  });

  it("awards a task only once, however often it is reopened and completed", async () => {
    const { owner, alice } = await setup();
    const task = await completeTask(owner, alice.userId, alice);
    for (let i = 0; i < 3; i++) {
      await updateTask(deps(), alice, task.id, { status: "IN_PROGRESS" });
      await updateTask(deps(), alice, task.id, { status: "COMPLETED" });
    }
    expect(await events(alice.userId)).toHaveLength(1);
  });

  it("awards once when the same completion is submitted concurrently", async () => {
    const { owner, alice } = await setup();
    const task = await createTask(deps(), owner, { title: "Race", assigneeId: alice.userId });
    await Promise.all([
      updateTask(deps(), alice, task.id, { status: "COMPLETED" }),
      updateTask(deps(), alice, task.id, { status: "COMPLETED" }),
    ]);
    expect(await events(alice.userId)).toHaveLength(1);
  });

  it("caps awards at 10 per user per UTC day", async () => {
    const { owner, alice } = await setup();
    for (let i = 0; i < DAILY_AWARD_CAP + 3; i++)
      await completeTask(owner, alice.userId, alice, "LOW");
    expect(await events(alice.userId)).toHaveLength(DAILY_AWARD_CAP);
    const stats = await getMyStats(deps(), alice);
    expect(stats).toMatchObject({
      awardsToday: DAILY_AWARD_CAP,
      dailyCap: DAILY_AWARD_CAP,
      totalPoints: 50,
    });
  });

  it("is append-only in the database", async () => {
    const { owner, alice } = await setup();
    await completeTask(owner, alice.userId, alice);
    const [event] = await events(alice.userId);
    await expect(
      db().pointEvent.update({ where: { id: event!.id }, data: { points: 100 } }),
    ).rejects.toThrow();
    await expect(db().pointEvent.delete({ where: { id: event!.id } })).rejects.toThrow();
    await expect(db().pointEvent.deleteMany({})).rejects.toThrow();
    expect(await db().pointEvent.count()).toBe(1);
  });

  it("derives a streak from award days", async () => {
    const { owner, alice } = await setup();
    await completeTask(owner, alice.userId, alice);
    const [event] = await events(alice.userId);
    // The ledger cannot be edited, so add earlier days through new rows with their own sources.
    for (const back of [1, 2]) {
      await db().pointEvent.create({
        data: {
          organizationId: alice.organization.id,
          userId: alice.userId,
          type: "TASK_COMPLETED",
          points: 5,
          sourceType: "task",
          sourceId: crypto.randomUUID(),
          createdAt: new Date(event!.createdAt.getTime() - back * DAY),
        },
      });
    }
    expect((await getMyStats(deps(), alice)).streakDays).toBe(3);
  });
});

describe("challenges", () => {
  beforeEach(resetDatabase);

  const window = (now = Date.now()) => ({
    title: "Sprint",
    target: 2,
    startsAt: new Date(now - DAY),
    endsAt: new Date(now + 7 * DAY),
  });

  it("is managed by managers and above, validated, and audited", async () => {
    const { manager, alice, viewer } = await setup();
    for (const context of [alice, viewer]) {
      await expectCode(createChallenge(deps(), context, window()), "FORBIDDEN");
    }
    await expectCode(createChallenge(deps(), manager, { ...window(), target: 0 }), "INVALID_INPUT");
    await createChallenge(deps(), manager, window());
    expect(await db().auditLog.count({ where: { action: "challenge.created" } })).toBe(1);
  });

  it("computes each person's progress from their own ledger entries inside the window", async () => {
    const { owner, manager, alice, bob } = await setup();
    await createChallenge(deps(), manager, window());
    await completeTask(owner, alice.userId, alice);
    await completeTask(owner, alice.userId, alice);
    await completeTask(owner, alice.userId, alice);
    await completeTask(owner, bob.userId, bob);

    const [forAlice] = await listChallenges(deps(), alice);
    expect(forAlice).toMatchObject({ progress: 2, target: 2, completed: true, state: "running" });
    const [forBob] = await listChallenges(deps(), bob);
    expect(forBob).toMatchObject({ progress: 1, completed: false });
    // An event outside the window does not count.
    const future = new Date(Date.now() + 30 * DAY);
    const [later] = await listChallenges(deps(), alice, future);
    expect(later!.state).toBe("ended");
  });

  it("archives challenges and hides them", async () => {
    const { manager, alice } = await setup();
    const { id } = await createChallenge(deps(), manager, window());
    await expectCode(archiveChallenge(deps(), alice, id), "FORBIDDEN");
    await archiveChallenge(deps(), manager, id);
    expect(await listChallenges(deps(), alice)).toEqual([]);
    await expectCode(archiveChallenge(deps(), manager, id), "NOT_FOUND");
    await expectCode(archiveChallenge(deps(), manager, "nope"), "NOT_FOUND");
  });
});

describe("leaderboard", () => {
  beforeEach(resetDatabase);

  it("is off by default and only the policy owner can change it", async () => {
    const { owner, admin, manager, alice } = await setup();
    expect(await getLeaderboard(deps(), alice)).toEqual({ enabled: false });
    await expectCode(setLeaderboardVisibility(deps(), manager, "OPT_IN"), "FORBIDDEN");
    await expectCode(setLeaderboardVisibility(deps(), admin, "EVERYONE"), "INVALID_INPUT");
    await setLeaderboardVisibility(deps(), admin, "OPT_IN");
    expect(await getLeaderboard(deps(), owner)).toEqual({ enabled: true, entries: [] });
    expect(await db().auditLog.count({ where: { action: "leaderboard.visibility_changed" } })).toBe(
      1,
    );
  });

  it("lists only members who opted in, ranked by points, and never exposes the others", async () => {
    const { owner, admin, alice, bob, viewer } = await setup();
    await setLeaderboardVisibility(deps(), admin, "OPT_IN");
    await completeTask(owner, alice.userId, alice, "URGENT");
    await completeTask(owner, bob.userId, bob, "LOW");
    await setLeaderboardOptIn(deps(), alice, true);

    let board = await getLeaderboard(deps(), viewer);
    expect(board).toMatchObject({
      enabled: true,
      entries: [{ rank: 1, userId: alice.userId, points: 20 }],
    });

    await setLeaderboardOptIn(deps(), bob, true);
    board = await getLeaderboard(deps(), viewer);
    expect(board.enabled && board.entries.map((e) => [e.userId, e.points, e.rank])).toEqual([
      [alice.userId, 20, 1],
      [bob.userId, 5, 2],
    ]);

    await setLeaderboardOptIn(deps(), alice, false);
    board = await getLeaderboard(deps(), viewer);
    expect(board.enabled && board.entries.map((e) => e.userId)).toEqual([bob.userId]);
    expect(JSON.stringify(board)).not.toContain("@");
  });

  it("limits rankings to the chosen period and to active members", async () => {
    const { owner, admin, alice, bob, acme } = await setup();
    await setLeaderboardVisibility(deps(), admin, "OPT_IN");
    await completeTask(owner, alice.userId, alice);
    await setLeaderboardOptIn(deps(), alice, true);
    await setLeaderboardOptIn(deps(), bob, true);
    await db().pointEvent.create({
      data: {
        organizationId: acme.organization.id,
        userId: bob.userId,
        type: "TASK_COMPLETED",
        points: 20,
        sourceType: "task",
        sourceId: crypto.randomUUID(),
        createdAt: new Date(Date.now() - 20 * DAY),
      },
    });
    const ids = async (range: string) => {
      const board = await getLeaderboard(deps(), alice, range);
      return board.enabled ? board.entries.map((e) => e.userId) : [];
    };
    expect(await ids("week")).toEqual([alice.userId]);
    expect(await ids("month")).toEqual([bob.userId, alice.userId]);
    await db().member.update({
      where: {
        organizationId_userId: { organizationId: acme.organization.id, userId: bob.userId },
      },
      data: { status: "DISABLED" },
    });
    expect(await ids("all")).toEqual([alice.userId]);
    await expectCode(getLeaderboard(deps(), alice, "forever"), "INVALID_INPUT");
  });

  describe("tenant isolation", () => {
    it("keeps points, challenges and rankings inside their organization", async () => {
      const { owner, alice, admin, globexOwner, manager } = await setup();
      await completeTask(owner, alice.userId, alice);
      await setLeaderboardVisibility(deps(), admin, "OPT_IN");
      await setLeaderboardOptIn(deps(), alice, true);
      const { id } = await createChallenge(deps(), manager, {
        title: "Acme only",
        target: 1,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
      });

      expect(await getLeaderboard(deps(), globexOwner)).toEqual({ enabled: false });
      expect(await listChallenges(deps(), globexOwner)).toEqual([]);
      expect((await getMyStats(deps(), globexOwner)).totalPoints).toBe(0);
      await expectCode(archiveChallenge(deps(), globexOwner, id), "NOT_FOUND");
      // Changing the policy only ever affects the caller's own organization.
      await setLeaderboardVisibility(deps(), globexOwner, "OPT_IN");
      await setLeaderboardVisibility(deps(), globexOwner, "OFF");
      expect((await getLeaderboard(deps(), alice)).enabled).toBe(true);
      const acmeBoard = await getLeaderboard(deps(), alice);
      expect(acmeBoard.enabled && acmeBoard.entries).toHaveLength(1);
    });
  });
});
