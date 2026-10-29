import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { listActiveMembers } from "@/features/organizations/server/organization-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { CommentForm } from "@/features/tasks/components/comment-form";
import { TaskStatusForm } from "@/features/tasks/components/task-status-form";
import { getTask, listComments } from "@/features/tasks/server/task-service";
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
  const [t, comments, members] = await Promise.all([
    getTranslations("Tasks"),
    listComments(deps, context, task.id),
    listActiveMembers(deps, context),
  ]);
  const names = new Map(members.map((member) => [member.userId, member.name]));
  const canUpdate = roleHasPermission(context.role, "task:update");
  const canComment = roleHasPermission(context.role, "task:comment");

  return (
    <WorkspaceShell context={context} active="tasks">
      <Link href={`/w/${organizationSlug}/tasks`} className="text-sm text-primary hover:underline">
        {t("back")}
      </Link>
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
          <TaskStatusForm
            organizationSlug={organizationSlug}
            taskId={task.id}
            status={task.status}
            priority={task.priority}
          />
        </Card>
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
