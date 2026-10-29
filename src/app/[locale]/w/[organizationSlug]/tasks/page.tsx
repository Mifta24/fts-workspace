import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { listGoals } from "@/features/goals/server/goal-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { listActiveMembers } from "@/features/organizations/server/organization-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { listProjects } from "@/features/projects/server/project-service";
import { CreateTaskForm } from "@/features/tasks/components/create-task-form";
import { TASK_STATUSES } from "@/features/tasks/schemas/task";
import { listTasks } from "@/features/tasks/server/task-service";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";
import { cn } from "@/lib/utils";

type View = "all" | "mine" | "overdue";

export default async function TasksPage({
  params,
  searchParams,
}: PageProps<"/[locale]/w/[organizationSlug]/tasks">) {
  const [{ organizationSlug }, query] = await Promise.all([params, searchParams]);
  const context = await requireWorkspace(organizationSlug, "task:read");
  const deps = { prisma: db() };

  const rawView = typeof query.view === "string" ? query.view : "all";
  const view: View = rawView === "mine" || rawView === "overdue" ? rawView : "all";
  const rawStatus = typeof query.status === "string" ? query.status : undefined;
  const status = TASK_STATUSES.find((value) => value === rawStatus);

  const [t, tasks, goals, projects, members] = await Promise.all([
    getTranslations("Tasks"),
    listTasks(deps, context, {
      status,
      assigneeId: view === "mine" ? context.userId : undefined,
      overdue: view === "overdue" || undefined,
    }),
    listGoals(deps, context),
    listProjects(deps, context),
    listActiveMembers(deps, context),
  ]);
  const memberNames = new Map(members.map((member) => [member.userId, member.name]));
  const canCreate = roleHasPermission(context.role, "task:create");
  const base = `/w/${organizationSlug}/tasks`;

  return (
    <WorkspaceShell context={context} active="tasks">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <nav aria-label={t("filters")} className="flex flex-wrap gap-2">
        {(["all", "mine", "overdue"] as const).map((value) => (
          <Link
            key={value}
            href={value === "all" ? base : `${base}?view=${value}`}
            aria-current={value === view ? "true" : undefined}
            className={cn(
              "rounded-md border border-border px-3 py-1 text-sm hover:bg-muted",
              value === view && "bg-muted font-medium",
            )}
          >
            {t(`view.${value}`)}
          </Link>
        ))}
      </nav>
      {tasks.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">
            {view === "all" && !status
              ? canCreate
                ? t("empty")
                : t("emptyReadOnly")
              : t("emptyFiltered")}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id} className="rounded-md border border-border bg-card p-3">
              <Link
                href={`${base}/${task.id}`}
                className="font-medium text-primary hover:underline"
              >
                {task.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {[
                  t(`status.${task.status}`),
                  t(`priority.${task.priority}`),
                  task.assigneeId ? memberNames.get(task.assigneeId) : t("unassigned"),
                  task.dueAt
                    ? t("due", { date: task.dueAt.toISOString().slice(0, 10) })
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <Card>
          <CardTitle className="mb-4 text-lg">{t("createTitle")}</CardTitle>
          <CreateTaskForm
            organizationSlug={organizationSlug}
            goals={goals.map((goal) => ({ id: goal.id, label: goal.title }))}
            projects={projects.map((project) => ({ id: project.id, label: project.name }))}
            members={members.map((member) => ({ id: member.userId, label: member.name }))}
          />
        </Card>
      )}
    </WorkspaceShell>
  );
}
