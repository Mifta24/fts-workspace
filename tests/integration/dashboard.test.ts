import { beforeEach, describe, expect, it } from "vitest";
import { getDashboard } from "@/features/dashboard/server/dashboard-service";
import { createGoal } from "@/features/goals/server/goal-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { createProject } from "@/features/projects/server/project-service";
import { createTask, updateTask } from "@/features/tasks/server/task-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const DAY = 86_400_000;

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });

async function setup() {
  const acme = await createTestOrganization("acme", { member: "MEMBER", viewer: "VIEWER" });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    owner: await contextFor("acme", acme.users.owner!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

describe("dashboard", () => {
  beforeEach(resetDatabase);

  it("returns zeros and a null progress for an empty organization", async () => {
    const { owner } = await setup();
    expect(await getDashboard(deps(), owner)).toEqual({
      activeGoals: 0,
      myOpenTasks: 0,
      completedTasks: 0,
      overdueTasks: 0,
      totalTasks: 0,
      progress: null,
    });
  });

  it("aggregates goals and tasks", async () => {
    const { owner, acme } = await setup();
    const ownerId = acme.users.owner!.id;
    await createGoal(deps(), owner, { title: "Active goal" });
    const archived = await createGoal(deps(), owner, { title: "Old goal" });
    await db().goal.update({ where: { id: archived.id }, data: { status: "ARCHIVED" } });

    const past = new Date(Date.now() - 2 * DAY);
    const future = new Date(Date.now() + 2 * DAY);
    const done = await createTask(deps(), owner, { title: "Done task", assigneeId: ownerId });
    await updateTask(deps(), owner, done.id, { status: "COMPLETED" });
    await createTask(deps(), owner, { title: "Late task", assigneeId: ownerId, dueAt: past });
    await createTask(deps(), owner, { title: "Future task", dueAt: future });
    const cancelled = await createTask(deps(), owner, { title: "Cancelled", dueAt: past });
    await updateTask(deps(), owner, cancelled.id, { status: "CANCELLED" });

    expect(await getDashboard(deps(), owner)).toEqual({
      activeGoals: 1,
      myOpenTasks: 1,
      completedTasks: 1,
      overdueTasks: 1,
      totalTasks: 3,
      progress: 33,
    });
  });

  it("limits completed tasks to the selected time range", async () => {
    const { owner } = await setup();
    const task = await createTask(deps(), owner, { title: "Ancient" });
    await updateTask(deps(), owner, task.id, { status: "COMPLETED" });
    await db().task.update({
      where: { id: task.id },
      data: { completedAt: new Date(Date.now() - 40 * DAY) },
    });

    expect((await getDashboard(deps(), owner, { range: "30" })).completedTasks).toBe(0);
    expect((await getDashboard(deps(), owner, { range: "90" })).completedTasks).toBe(1);
    expect((await getDashboard(deps(), owner, { range: "all" })).completedTasks).toBe(1);
  });

  it("filters by project and assignee", async () => {
    const { owner, acme } = await setup();
    const project = await createProject(deps(), owner, { name: "Website" });
    await createGoal(deps(), owner, { title: "In project", projectId: project.id });
    await createGoal(deps(), owner, { title: "Elsewhere" });
    await createTask(deps(), owner, {
      title: "Project task",
      projectId: project.id,
      assigneeId: acme.users.member!.id,
    });
    await createTask(deps(), owner, { title: "Other task" });

    const byProject = await getDashboard(deps(), owner, { projectId: project.id });
    expect(byProject).toMatchObject({ activeGoals: 1, totalTasks: 1 });
    const byAssignee = await getDashboard(deps(), owner, { assigneeId: acme.users.member!.id });
    expect(byAssignee.totalTasks).toBe(1);
  });

  it("lets every role, including viewers, read the dashboard but rejects bad filters", async () => {
    const { viewer } = await setup();
    await expect(getDashboard(deps(), viewer)).resolves.toBeDefined();
    await expect(getDashboard(deps(), viewer, { range: "9999" })).rejects.toSatisfy(
      (error: unknown) => error instanceof AppError && error.code === "INVALID_INPUT",
    );
  });

  describe("tenant isolation", () => {
    it("never counts another organization's goals or tasks", async () => {
      const { owner, globexOwner } = await setup();
      await createGoal(deps(), globexOwner, { title: "Globex goal" });
      const task = await createTask(deps(), globexOwner, {
        title: "Globex task",
        dueAt: new Date(Date.now() - DAY),
      });
      await updateTask(deps(), globexOwner, task.id, { status: "COMPLETED" });
      await createTask(deps(), globexOwner, {
        title: "Globex open",
        dueAt: new Date(Date.now() - DAY),
      });

      expect(await getDashboard(deps(), owner, { range: "all" })).toMatchObject({
        activeGoals: 0,
        completedTasks: 0,
        overdueTasks: 0,
        totalTasks: 0,
        progress: null,
      });
    });

    it("treats a foreign project or assignee id as matching nothing", async () => {
      const { owner, globexOwner } = await setup();
      const foreignProject = await createProject(deps(), globexOwner, { name: "Globex project" });
      await createTask(deps(), globexOwner, { title: "Foreign", projectId: foreignProject.id });
      expect(await getDashboard(deps(), owner, { projectId: foreignProject.id })).toMatchObject({
        activeGoals: 0,
        totalTasks: 0,
      });
      expect(await getDashboard(deps(), owner, { assigneeId: globexOwner.userId })).toMatchObject({
        totalTasks: 0,
      });
    });
  });
});
