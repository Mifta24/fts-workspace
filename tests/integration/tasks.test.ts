import { beforeEach, describe, expect, it } from "vitest";
import { createGoal, getGoal } from "@/features/goals/server/goal-service";
import {
  getAuthorizedOrganization,
  listActiveMembers,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { createProject } from "@/features/projects/server/project-service";
import {
  addComment,
  createTask,
  getTask,
  listComments,
  listTasks,
  MAX_TASK_DEPTH,
  updateTask,
} from "@/features/tasks/server/task-service";
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
  const acme = await createTestOrganization("acme", { member: "MEMBER", viewer: "VIEWER" });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    globex,
    owner: await contextFor("acme", acme.users.owner!.id),
    member: await contextFor("acme", acme.users.member!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

describe("tasks", () => {
  beforeEach(resetDatabase);

  it("creates a task with defaults, an assignee and an audit event", async () => {
    const { owner, acme } = await setup();
    const task = await createTask(deps(), owner, {
      title: "Build dashboard",
      assigneeId: acme.users.member!.id,
      priority: "HIGH",
    });
    expect(task).toMatchObject({
      status: "TODO",
      priority: "HIGH",
      assigneeId: acme.users.member!.id,
      completedAt: null,
    });
    const row = await db().task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.organizationId).toBe(acme.organization.id);
    expect(
      await db().auditLog.count({ where: { action: "task.created", resourceId: task.id } }),
    ).toBe(1);
  });

  it("rejects invalid input and enforces the role matrix", async () => {
    const { owner, viewer, member } = await setup();
    await expectCode(createTask(deps(), owner, { title: "x" }), "INVALID_INPUT");
    await expectCode(createTask(deps(), viewer, { title: "Nope nope" }), "FORBIDDEN");
    const task = await createTask(deps(), member, { title: "Member task" });
    await expectCode(updateTask(deps(), viewer, task.id, { status: "COMPLETED" }), "FORBIDDEN");
    await expectCode(addComment(deps(), viewer, task.id, { body: "hello" }), "FORBIDDEN");
    expect((await getTask(deps(), viewer, task.id)).title).toBe("Member task");
  });

  it("sets completedAt once on completion, audits it, and clears it on reopen", async () => {
    const { owner } = await setup();
    const task = await createTask(deps(), owner, { title: "Finish report" });
    const done = await updateTask(deps(), owner, task.id, { status: "COMPLETED" });
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(
      await db().auditLog.count({ where: { action: "task.completed", resourceId: task.id } }),
    ).toBe(1);

    const again = await updateTask(deps(), owner, task.id, { priority: "LOW" });
    expect(again.completedAt?.getTime()).toBe(done.completedAt!.getTime());
    expect(
      await db().auditLog.count({ where: { action: "task.completed", resourceId: task.id } }),
    ).toBe(1);

    const reopened = await updateTask(deps(), owner, task.id, { status: "IN_PROGRESS" });
    expect(reopened.completedAt).toBeNull();
  });

  it("handles concurrent completion without duplicating the completion event", async () => {
    const { owner, member } = await setup();
    const task = await createTask(deps(), owner, { title: "Race me" });
    await Promise.all([
      updateTask(deps(), owner, task.id, { status: "COMPLETED" }),
      updateTask(deps(), member, task.id, { status: "COMPLETED" }),
    ]);
    expect(
      await db().auditLog.count({ where: { action: "task.completed", resourceId: task.id } }),
    ).toBe(1);
  });

  it("validates assignees: same organization and active only", async () => {
    const { owner, globex, acme } = await setup();
    await expectCode(
      createTask(deps(), owner, { title: "Foreign assignee", assigneeId: globex.users.owner!.id }),
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
      createTask(deps(), owner, { title: "Disabled assignee", assigneeId: acme.users.member!.id }),
      "UNPROCESSABLE",
    );
    const task = await createTask(deps(), owner, {
      title: "Assign me",
      assigneeId: acme.users.owner!.id,
    });
    expect((await updateTask(deps(), owner, task.id, { assigneeId: "" })).assigneeId).toBeNull();
    expect((await listActiveMembers(deps(), owner)).map((m) => m.userId)).not.toContain(
      acme.users.member!.id,
    );
  });

  it("links tasks to goals and projects of the same organization only", async () => {
    const { owner, globexOwner } = await setup();
    const goal = await createGoal(deps(), owner, { title: "Launch" });
    const project = await createProject(deps(), owner, { name: "Website" });
    const task = await createTask(deps(), owner, {
      title: "Linked",
      goalId: goal.id,
      projectId: project.id,
    });
    expect(task).toMatchObject({ goalId: goal.id, projectId: project.id });

    const foreignGoal = await createGoal(deps(), globexOwner, { title: "Foreign goal" });
    const foreignProject = await createProject(deps(), globexOwner, { name: "Foreign project" });
    await expectCode(
      createTask(deps(), owner, { title: "Cross goal", goalId: foreignGoal.id }),
      "UNPROCESSABLE",
    );
    await expectCode(
      createTask(deps(), owner, { title: "Cross project", projectId: foreignProject.id }),
      "UNPROCESSABLE",
    );
    await expectCode(
      updateTask(deps(), owner, task.id, { goalId: foreignGoal.id }),
      "UNPROCESSABLE",
    );
  });

  it("drives task-based goal progress from completed tasks, ignoring cancelled ones", async () => {
    const { owner } = await setup();
    const goal = await createGoal(deps(), owner, { title: "Ship", progressMode: "TASK_BASED" });
    expect(goal.progress).toBeNull();
    const a = await createTask(deps(), owner, { title: "Task A", goalId: goal.id });
    await createTask(deps(), owner, { title: "Task B", goalId: goal.id });
    const c = await createTask(deps(), owner, { title: "Task C", goalId: goal.id });
    await updateTask(deps(), owner, a.id, { status: "COMPLETED" });
    await updateTask(deps(), owner, c.id, { status: "CANCELLED" });
    expect((await getGoal(deps(), owner, goal.id)).progress).toBe(50);
  });

  it("supports subtasks but rejects cycles and excessive depth", async () => {
    const { owner } = await setup();
    const a = await createTask(deps(), owner, { title: "Task A" });
    const b = await createTask(deps(), owner, { title: "Task B", parentTaskId: a.id });
    const c = await createTask(deps(), owner, { title: "Task C", parentTaskId: b.id });
    await expectCode(updateTask(deps(), owner, a.id, { parentTaskId: a.id }), "UNPROCESSABLE");
    await expectCode(updateTask(deps(), owner, a.id, { parentTaskId: c.id }), "UNPROCESSABLE");

    let parentTaskId: string | undefined;
    for (let level = 1; level <= MAX_TASK_DEPTH; level++) {
      parentTaskId = (await createTask(deps(), owner, { title: `Level ${level}`, parentTaskId }))
        .id;
    }
    await expectCode(
      createTask(deps(), owner, { title: "Too deep", parentTaskId }),
      "UNPROCESSABLE",
    );
  });

  it("filters by status, assignee and overdue", async () => {
    const { owner, acme } = await setup();
    const past = new Date(Date.now() - 86_400_000);
    await createTask(deps(), owner, {
      title: "Late task",
      dueAt: past,
      assigneeId: acme.users.owner!.id,
    });
    await createTask(deps(), owner, { title: "Done late", dueAt: past, status: "COMPLETED" });
    await createTask(deps(), owner, { title: "Backlog item", status: "BACKLOG" });

    const titles = async (filter: object) =>
      (await listTasks(deps(), owner, filter)).map((t) => t.title).sort();
    expect(await titles({ overdue: true })).toEqual(["Late task"]);
    expect(await titles({ status: "BACKLOG" })).toEqual(["Backlog item"]);
    expect(await titles({ assigneeId: acme.users.owner!.id })).toEqual(["Late task"]);
    await expectCode(listTasks(deps(), owner, { status: "NOPE" }), "INVALID_INPUT");
  });

  it("adds comments and keeps their content out of the audit trail", async () => {
    const { owner, member } = await setup();
    const task = await createTask(deps(), owner, { title: "Discuss" });
    await addComment(deps(), member, task.id, { body: "  Looks good, secret-ish text  " });
    const comments = await listComments(deps(), owner, task.id);
    expect(comments.map((c) => c.body)).toEqual(["Looks good, secret-ish text"]);
    const audit = await db().auditLog.findMany({ where: { action: "task.commented" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain("secret-ish");
    await expectCode(addComment(deps(), owner, task.id, { body: "  " }), "INVALID_INPUT");
  });

  describe("tenant isolation", () => {
    it("hides, and refuses to mutate or comment on, another organization's task", async () => {
      const { owner, globexOwner } = await setup();
      const foreign = await createTask(deps(), globexOwner, { title: "Globex secret" });

      expect(await listTasks(deps(), owner)).toEqual([]);
      await expectCode(getTask(deps(), owner, foreign.id), "NOT_FOUND");
      await expectCode(updateTask(deps(), owner, foreign.id, { title: "Hijacked" }), "NOT_FOUND");
      await expectCode(addComment(deps(), owner, foreign.id, { body: "hi" }), "NOT_FOUND");
      await expectCode(listComments(deps(), owner, "not-a-uuid"), "NOT_FOUND");
      expect(await listComments(deps(), owner, foreign.id)).toEqual([]);
      expect(await db().task.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({
        title: "Globex secret",
      });
      expect(await db().taskComment.count()).toBe(0);
    });

    it("does not let a foreign parent task or assignee filter leak data", async () => {
      const { owner, globexOwner, globex } = await setup();
      const foreign = await createTask(deps(), globexOwner, { title: "Globex parent" });
      await expectCode(
        createTask(deps(), owner, { title: "Child", parentTaskId: foreign.id }),
        "UNPROCESSABLE",
      );
      expect(await listTasks(deps(), owner, { assigneeId: globex.users.owner!.id })).toEqual([]);
    });

    it("rejects cross-tenant references at the database level", async () => {
      const { acme, globex } = await setup();
      const foreign = await db().task.create({
        data: {
          organizationId: globex.organization.id,
          title: "Foreign",
          createdById: globex.users.owner!.id,
        },
      });
      await expect(
        db().task.create({
          data: {
            organizationId: acme.organization.id,
            parentTaskId: foreign.id,
            title: "Bad child",
            createdById: acme.users.owner!.id,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db().taskComment.create({
          data: {
            organizationId: acme.organization.id,
            taskId: foreign.id,
            authorId: acme.users.owner!.id,
            body: "x",
          },
        }),
      ).rejects.toThrow();
    });

    it("keeps completion state consistent in the database", async () => {
      const { acme } = await setup();
      await expect(
        db().task.create({
          data: {
            organizationId: acme.organization.id,
            title: "Inconsistent",
            status: "COMPLETED",
            createdById: acme.users.owner!.id,
          },
        }),
      ).rejects.toThrow();
    });
  });
});

describe("task editing", () => {
  beforeEach(resetDatabase);

  it("edits every field, clears nullable ones and keeps unrelated fields", async () => {
    const { owner, acme } = await setup();
    const goal = await createGoal(deps(), owner, { title: "Parent goal" });
    const task = await createTask(deps(), owner, {
      title: "Original",
      description: "Details",
      goalId: goal.id,
      assigneeId: acme.users.member!.id,
      dueAt: "2026-12-01",
    });
    const edited = await updateTask(deps(), owner, task.id, {
      title: "Renamed",
      priority: "URGENT",
      description: "",
      goalId: "",
      assigneeId: "",
      dueAt: "",
    });
    expect(edited).toMatchObject({
      title: "Renamed",
      priority: "URGENT",
      description: null,
      goalId: null,
      assigneeId: null,
      dueAt: null,
      status: "TODO",
    });
  });

  it("rejects inverted dates against the stored value", async () => {
    const { owner } = await setup();
    const task = await createTask(deps(), owner, { title: "Dated", startsAt: "2026-12-10" });
    await expectCode(updateTask(deps(), owner, task.id, { dueAt: "2026-12-01" }), "INVALID_INPUT");
  });
});

describe("subtask listing", () => {
  beforeEach(resetDatabase);

  it("lists only direct subtasks of the given parent within the organization", async () => {
    const { owner, globexOwner } = await setup();
    const parent = await createTask(deps(), owner, { title: "Parent" });
    const child = await createTask(deps(), owner, { title: "Child", parentTaskId: parent.id });
    await createTask(deps(), owner, { title: "Grandchild", parentTaskId: child.id });
    await createTask(deps(), owner, { title: "Unrelated" });

    expect(
      (await listTasks(deps(), owner, { parentTaskId: parent.id })).map((t) => t.title),
    ).toEqual(["Child"]);
    expect(await listTasks(deps(), globexOwner, { parentTaskId: parent.id })).toEqual([]);
  });
});
