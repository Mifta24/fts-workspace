import { beforeEach, describe, expect, it } from "vitest";
import { archiveGoal, createGoal, getGoal } from "@/features/goals/server/goal-service";
import {
  addMilestone,
  deleteMilestone,
  listMilestones,
  setMilestoneCompleted,
} from "@/features/milestones/server/milestone-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
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
  const acme = await createTestOrganization("acme", { viewer: "VIEWER" });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    owner: await contextFor("acme", acme.users.owner!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

describe("milestones", () => {
  beforeEach(resetDatabase);

  it("drives milestone-based goal progress", async () => {
    const { owner } = await setup();
    const goal = await createGoal(deps(), owner, {
      title: "Release",
      progressMode: "MILESTONE_BASED",
    });
    expect(goal.progress).toBeNull();
    const a = await addMilestone(deps(), owner, goal.id, { title: "Beta" });
    await addMilestone(deps(), owner, goal.id, { title: "GA", dueAt: "2026-12-01" });
    expect((await getGoal(deps(), owner, goal.id)).progress).toBe(0);
    await setMilestoneCompleted(deps(), owner, a.id, true);
    expect((await getGoal(deps(), owner, goal.id)).progress).toBe(50);
    await setMilestoneCompleted(deps(), owner, a.id, false);
    expect((await getGoal(deps(), owner, goal.id)).progress).toBe(0);
  });

  it("is idempotent when repeating a transition and audits each real change once", async () => {
    const { owner } = await setup();
    const goal = await createGoal(deps(), owner, { title: "Release" });
    const m = await addMilestone(deps(), owner, goal.id, { title: "Beta" });
    const first = await setMilestoneCompleted(deps(), owner, m.id, true);
    const second = await setMilestoneCompleted(deps(), owner, m.id, true);
    expect(second.completedAt?.getTime()).toBe(first.completedAt!.getTime());
    expect(await db().auditLog.count({ where: { action: "milestone.completed" } })).toBe(1);
  });

  it("validates input, enforces permissions and blocks edits on archived goals", async () => {
    const { owner, viewer } = await setup();
    const goal = await createGoal(deps(), owner, { title: "Release" });
    await expectCode(addMilestone(deps(), owner, goal.id, { title: "x" }), "INVALID_INPUT");
    await expectCode(addMilestone(deps(), viewer, goal.id, { title: "Viewer try" }), "FORBIDDEN");
    const m = await addMilestone(deps(), owner, goal.id, { title: "Beta" });
    expect(await listMilestones(deps(), viewer, goal.id)).toHaveLength(1);
    await archiveGoal(deps(), owner, goal.id);
    await expectCode(addMilestone(deps(), owner, goal.id, { title: "Late one" }), "UNPROCESSABLE");
    await expectCode(setMilestoneCompleted(deps(), owner, m.id, true), "UNPROCESSABLE");
    await expectCode(deleteMilestone(deps(), owner, m.id), "UNPROCESSABLE");
  });

  it("deletes a milestone and records it", async () => {
    const { owner } = await setup();
    const goal = await createGoal(deps(), owner, { title: "Release" });
    const m = await addMilestone(deps(), owner, goal.id, { title: "Beta" });
    await deleteMilestone(deps(), owner, m.id);
    expect(await listMilestones(deps(), owner, goal.id)).toEqual([]);
    expect(await db().auditLog.count({ where: { action: "milestone.deleted" } })).toBe(1);
  });

  describe("tenant isolation", () => {
    it("cannot read, add to, toggle or delete another organization's milestones", async () => {
      const { owner, globexOwner } = await setup();
      const foreignGoal = await createGoal(deps(), globexOwner, { title: "Globex goal" });
      const foreign = await addMilestone(deps(), globexOwner, foreignGoal.id, { title: "Secret" });

      expect(await listMilestones(deps(), owner, foreignGoal.id)).toEqual([]);
      await expectCode(
        addMilestone(deps(), owner, foreignGoal.id, { title: "Inject" }),
        "NOT_FOUND",
      );
      await expectCode(setMilestoneCompleted(deps(), owner, foreign.id, true), "NOT_FOUND");
      await expectCode(deleteMilestone(deps(), owner, foreign.id), "NOT_FOUND");
      expect(await db().milestone.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({
        completedAt: null,
      });
    });

    it("rejects cross-tenant goal references at the database level", async () => {
      const { acme, owner, globexOwner } = await setup();
      const foreignGoal = await createGoal(deps(), globexOwner, { title: "Globex goal" });
      await expect(
        db().milestone.create({
          data: {
            organizationId: acme.organization.id,
            goalId: foreignGoal.id,
            title: "Bad",
            createdById: owner.userId,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
