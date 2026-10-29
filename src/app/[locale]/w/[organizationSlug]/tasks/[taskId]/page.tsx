import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { listActiveMembers } from "@/features/organizations/server/organization-service";
import { listGoals } from "@/features/goals/server/goal-service";
import { listProjects } from "@/features/projects/server/project-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { CommentForm } from "@/features/tasks/components/comment-form";
import { EditTaskForm } from "@/features/tasks/components/edit-task-form";
import { getTask, listComments, listTasks } from "@/features/tasks/server/task-service";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { roleHasPermission } from "@/lib/permissions/matrix";

export default async function TaskPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/tasks/[taskId]">) {
  const { organizationSlug, taskId } = await params;
  const context = await requireWorkspace(organizationSlug, "task:read");
  const deps = { prisma: db() };

  const task = await getTask(deps, context, taskId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [t, comments, members, goals, projects, subtasks, allTasks] = await Promise.all([
    getTranslations("Tasks"),
    listComments(deps, context, task.id),
    listActiveMembers(deps, context),
    listGoals(deps, context),
    listProjects(deps, context),
    listTasks(deps, context, { parentTaskId: task.id }),
    listTasks(deps, context),
  ]);
  const names = new Map(members.map((member) => [member.userId, member.name]));
  const canUpdate = roleHasPermission(context.role, "task:update");
  const canComment = roleHasPermission(context.role, "task:comment");

  return (
    <WorkspaceShell context={context} active="tasks">
      <Link href={`/w/${organizationSlug}/tasks`} className="text-sm text-primary hover:underline">
        {t("back")}
      </Link>
      {task.parentTaskId && (
        <p className="text-sm text-muted-foreground">
          {t("subtaskOf")}{" "}
          <Link
            href={`/w/${organizationSlug}/tasks/${task.parentTaskId}`}
            className="text-primary hover:underline"
          >
            {allTasks.find((other) => other.id === task.parentTaskId)?.title ?? t("parentLabel")}
          </Link>
        </p>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
      <p className="text-sm text-muted-foreground">
        {[
          t(`status.${task.status}`),
          t(`priority.${task.priority}`),
          task.assigneeId ? names.get(task.assigneeId) : t("unassigned"),
          task.dueAt ? t("due", { date: task.dueAt.toISOString().slice(0, 10) }) : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {task.description && <p className="whitespace-pre-wrap">{task.description}</p>}
      {canUpdate && (
        <Card>
          <EditTaskForm
            organizationSlug={organizationSlug}
            task={{
              ...task,
              dueDate: task.dueAt ? task.dueAt.toISOString().slice(0, 10) : "",
            }}
            goals={goals.map((goal) => ({ id: goal.id, label: goal.title }))}
            projects={projects.map((project) => ({ id: project.id, label: project.name }))}
            members={members.map((member) => ({ id: member.userId, label: member.name }))}
            // Descendants are rejected by the service; the task itself is never offered.
            tasks={allTasks
              .filter((other) => other.id !== task.id)
              .map((other) => ({ id: other.id, label: other.title }))}
          />
        </Card>
      )}
      {subtasks.length > 0 && (
        <section aria-labelledby="subtasks-title" className="space-y-2">
          <CardTitle id="subtasks-title" className="text-lg">
            {t("subtasks")}
          </CardTitle>
          <ul className="space-y-2">
            {subtasks.map((subtask) => (
              <li key={subtask.id} className="rounded-md border border-border bg-card p-3">
                <Link
                  href={`/w/${organizationSlug}/tasks/${subtask.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {subtask.title}
                </Link>
                <p className="text-xs text-muted-foreground">{t(`status.${subtask.status}`)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="comments-title" className="space-y-3">
        <CardTitle id="comments-title" className="text-lg">
          {t("comments")}
        </CardTitle>
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noComments")}</p>
        ) : (
          <ul className="space-y-2">
            {comments.map((comment) => (
              <li key={comment.id} className="rounded-md border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {names.get(comment.authorId) ?? t("formerMember")} ·{" "}
                  {comment.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </p>
                <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}
        {canComment && <CommentForm organizationSlug={organizationSlug} taskId={task.id} />}
      </section>
    </WorkspaceShell>
  );
}
