import { beforeEach, describe, expect, it } from "vitest";
import {
  archiveGoal,
  createGoal,
  getGoal,
  listGoals,
  MAX_GOAL_DEPTH,
  updateGoal,
} from "@/features/goals/server/goal-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  updateProject,
} from "@/features/projects/server/project-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

async function contextFor(slug: string, userId: string): Promise<OrganizationContext> {
  return getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });
}

async function setup() {
  const acme = await createTestOrganization("acme", {
    manager: "MANAGER",
    member: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    globex,
    owner: await contextFor("acme", acme.users.owner!.id),
    manager: await contextFor("acme", acme.users.manager!.id),
    member: await contextFor("acme", acme.users.member!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

describe("goals", () => {
  beforeEach(resetDatabase);

  it("creates a goal scoped to the caller's organization with an audit event", async () => {
    const { owner, acme } = await setup();
    const goal = await createGoal(deps(), owner, {
      title: "Grow revenue",
      progressMode: "MANUAL",
      manualProgress: "30",
    });
    expect(goal).toMatchObject({
      title: "Grow revenue",
      progress: 30,
      ownerId: acme.users.owner!.id,
    });
    const row = await db().goal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(row.organizationId).toBe(acme.organization.id);
    expect(
      await db().auditLog.count({ where: { action: "goal.created", resourceId: goal.id } }),
    ).toBe(1);
  });

  it("computes KPI progress", async () => {
    const { owner } = await setup();
    const goal = await createGoal(deps(), owner, {
      title: "Signups",
      progressMode: "NUMERIC_KPI",
      targetValue: "200",
      currentValue: "50",
    });
    expect(goal.progress).toBe(25);
  });

  it("rejects invalid input", async () => {
    const { owner } = await setup();
    await expectCode(createGoal(deps(), owner, { title: "x" }), "INVALID_INPUT");
    await expectCode(
      createGoal(deps(), owner, { title: "Okay", progressMode: "NUMERIC_KPI" }),
      "INVALID_INPUT",
    );
  });

  it("enforces the role matrix", async () => {
    const { viewer, member, manager } = await setup();
    await expectCode(createGoal(deps(), viewer, { title: "Nope" }), "FORBIDDEN");
    const goal = await createGoal(deps(), member, { title: "Member goal" });
    await expectCode(archiveGoal(deps(), member, goal.id), "FORBIDDEN");
    await expectCode(createProject(deps(), member, { name: "Nope" }), "FORBIDDEN");
    await archiveGoal(deps(), manager, goal.id);
    expect((await getGoal(deps(), viewer, goal.id)).status).toBe("ARCHIVED");
  });

  it("nests goals and lists the tree inputs", async () => {
    const { owner } = await setup();
    const root = await createGoal(deps(), owner, { title: "Root" });
    const child = await createGoal(deps(), owner, { title: "Child", parentGoalId: root.id });
    const goals = await listGoals(deps(), owner);
    expect(goals.map((g) => g.id)).toEqual([root.id, child.id]);
    expect(goals[1]!.parentGoalId).toBe(root.id);
  });

  it("rejects moving a goal under itself or its descendants", async () => {
    const { owner } = await setup();
    const a = await createGoal(deps(), owner, { title: "Goal A" });
    const b = await createGoal(deps(), owner, { title: "Goal B", parentGoalId: a.id });
    const c = await createGoal(deps(), owner, { title: "Goal C", parentGoalId: b.id });
    await expectCode(updateGoal(deps(), owner, a.id, { parentGoalId: a.id }), "UNPROCESSABLE");
    await expectCode(updateGoal(deps(), owner, a.id, { parentGoalId: c.id }), "UNPROCESSABLE");
    expect((await getGoal(deps(), owner, a.id)).parentGoalId).toBeNull();
    // Moving to a non-descendant and detaching are fine.
    await updateGoal(deps(), owner, c.id, { parentGoalId: a.id });
    expect((await updateGoal(deps(), owner, c.id, { parentGoalId: "" })).parentGoalId).toBeNull();
  });

  it("serializes concurrent opposite moves so no cycle can form", async () => {
    const { owner } = await setup();
    const a = await createGoal(deps(), owner, { title: "Goal A" });
    const b = await createGoal(deps(), owner, { title: "Goal B" });
    const results = await Promise.allSettled([
      updateGoal(deps(), owner, a.id, { parentGoalId: b.id }),
      updateGoal(deps(), owner, b.id, { parentGoalId: a.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("caps nesting depth", async () => {
    const { owner } = await setup();
    let parentGoalId: string | undefined;
    for (let level = 1; level <= MAX_GOAL_DEPTH; level++) {
      parentGoalId = (await createGoal(deps(), owner, { title: `Level ${level}`, parentGoalId }))
        .id;
    }
    await expectCode(
      createGoal(deps(), owner, { title: "Too deep", parentGoalId }),
      "UNPROCESSABLE",
    );
  });

  it("refuses to archive a goal with active subgoals", async () => {
    const { owner } = await setup();
    const parent = await createGoal(deps(), owner, { title: "Parent" });
    const child = await createGoal(deps(), owner, { title: "Child", parentGoalId: parent.id });
    await expectCode(archiveGoal(deps(), owner, parent.id), "CONFLICT");
    await archiveGoal(deps(), owner, child.id);
    await archiveGoal(deps(), owner, parent.id);
    await expectCode(updateGoal(deps(), owner, parent.id, { title: "Renamed" }), "UNPROCESSABLE");
    expect(await listGoals(deps(), owner)).toHaveLength(0);
  });

  it("validates owners are active members of the same organization", async () => {
    const { owner, globex, acme } = await setup();
    await expectCode(
      createGoal(deps(), owner, { title: "Foreign owner", ownerId: globex.users.owner!.id }),
      "UNPROCESSABLE",
    );
    await db().member.update({
      where: {
        organizationId_userId: {
          organizationId: acme.organization.id,
          userId: acme.users.member!.id,
        },
      },
      data: { status: "DISABLED" },
    });
    await expectCode(
      createGoal(deps(), owner, { title: "Disabled owner", ownerId: acme.users.member!.id }),
      "UNPROCESSABLE",
    );
  });

  it("enforces a project's organization and active state", async () => {
    const { owner, globexOwner } = await setup();
    const foreignProject = await createProject(deps(), globexOwner, { name: "Globex project" });
    await expectCode(
      createGoal(deps(), owner, { title: "Cross", projectId: foreignProject.id }),
      "UNPROCESSABLE",
    );

    const project = await createProject(deps(), owner, { name: "Acme project" });
    const goal = await createGoal(deps(), owner, { title: "In project", projectId: project.id });
    expect(goal.projectId).toBe(project.id);
    await archiveProject(deps(), owner, project.id);
    expect(await listProjects(deps(), owner)).toHaveLength(0);
    await expectCode(
      createGoal(deps(), owner, { title: "Late", projectId: project.id }),
      "UNPROCESSABLE",
    );
  });

  describe("tenant isolation", () => {
    it("hides another organization's goals and treats them as nonexistent", async () => {
      const { owner, globexOwner } = await setup();
      const foreign = await createGoal(deps(), globexOwner, { title: "Globex secret" });

      expect(await listGoals(deps(), owner)).toEqual([]);
      await expectCode(getGoal(deps(), owner, foreign.id), "NOT_FOUND");
      await expectCode(updateGoal(deps(), owner, foreign.id, { title: "Hijacked" }), "NOT_FOUND");
      await expectCode(archiveGoal(deps(), owner, foreign.id), "NOT_FOUND");
      await expectCode(getGoal(deps(), owner, "not-a-uuid"), "NOT_FOUND");
      const row = await db().goal.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(row).toMatchObject({ title: "Globex secret", status: "ACTIVE" });
    });

    it("cannot attach a goal to another organization's parent goal", async () => {
      const { owner, globexOwner } = await setup();
      const foreign = await createGoal(deps(), globexOwner, { title: "Globex parent" });
      await expectCode(
        createGoal(deps(), owner, { title: "Child", parentGoalId: foreign.id }),
        "UNPROCESSABLE",
      );
      const local = await createGoal(deps(), owner, { title: "Local" });
      await expectCode(
        updateGoal(deps(), owner, local.id, { parentGoalId: foreign.id }),
        "UNPROCESSABLE",
      );
    });

    it("rejects cross-tenant references at the database level", async () => {
      const { acme, globex } = await setup();
      const parent = await db().goal.create({
        data: {
          organizationId: globex.organization.id,
          title: "Foreign",
          ownerId: globex.users.owner!.id,
          createdById: globex.users.owner!.id,
        },
      });
      await expect(
        db().goal.create({
          data: {
            organizationId: acme.organization.id,
            parentGoalId: parent.id,
            title: "Bad child",
            ownerId: acme.users.owner!.id,
            createdById: acme.users.owner!.id,
          },
        }),
      ).rejects.toThrow();
    });

    it("does not leak projects across organizations", async () => {
      const { owner, globexOwner } = await setup();
      const foreign = await createProject(deps(), globexOwner, { name: "Globex project" });
      expect(await listProjects(deps(), owner)).toEqual([]);
      await expectCode(archiveProject(deps(), owner, foreign.id), "NOT_FOUND");
    });
  });
});

describe("editing", () => {
  beforeEach(resetDatabase);

  it("clears optional goal fields and cannot archive through update", async () => {
    const { owner, member } = await setup();
    const goal = await createGoal(deps(), owner, {
      title: "Editable",
      description: "Old text",
      dueAt: "2026-12-01",
    });
    const cleared = await updateGoal(deps(), owner, goal.id, { description: "", dueAt: "" });
    expect(cleared).toMatchObject({ description: null, dueAt: null, title: "Editable" });

    // MEMBER has goal:update but not goal:archive, so ARCHIVED must be unreachable here.
    await expectCode(updateGoal(deps(), member, goal.id, { status: "ARCHIVED" }), "INVALID_INPUT");
    expect((await getGoal(deps(), owner, goal.id)).status).toBe("ACTIVE");
  });

  it("switches a goal to KPI using the stored target and rejects it without one", async () => {
    const { owner } = await setup();
    const goal = await createGoal(deps(), owner, { title: "Mode switch" });
    await expectCode(
      updateGoal(deps(), owner, goal.id, { progressMode: "NUMERIC_KPI" }),
      "INVALID_INPUT",
    );
    const kpi = await updateGoal(deps(), owner, goal.id, {
      progressMode: "NUMERIC_KPI",
      targetValue: "40",
      currentValue: "10",
    });
    expect(kpi.progress).toBe(25);
    expect((await updateGoal(deps(), owner, goal.id, { currentValue: "20" })).progress).toBe(50);
  });

  it("edits and clears project descriptions, scoped to the organization", async () => {
    const { owner, globexOwner } = await setup();
    const project = await createProject(deps(), owner, { name: "Alpha", description: "Pilot" });
    const renamed = await updateProject(deps(), owner, project.id, {
      name: "Alpha 2",
      description: "",
    });
    expect(renamed).toMatchObject({ name: "Alpha 2", description: null });
    expect(await getProject(deps(), owner, project.id)).toMatchObject({ name: "Alpha 2" });

    await expectCode(
      updateProject(deps(), globexOwner, project.id, { name: "Hijack" }),
      "NOT_FOUND",
    );
    await expectCode(getProject(deps(), globexOwner, project.id), "NOT_FOUND");
    await expectCode(updateProject(deps(), owner, project.id, { name: "x" }), "INVALID_INPUT");
  });
});
