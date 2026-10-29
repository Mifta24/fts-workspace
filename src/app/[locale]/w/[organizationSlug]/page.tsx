import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DASHBOARD_RANGES, dashboardFilterSchema } from "@/features/dashboard/schemas/dashboard";
import { getDashboard } from "@/features/dashboard/server/dashboard-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { listActiveMembers } from "@/features/organizations/server/organization-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { listProjects } from "@/features/projects/server/project-service";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function WorkspacePage({
  params,
  searchParams,
}: PageProps<"/[locale]/w/[organizationSlug]">) {
  const [{ organizationSlug }, query] = await Promise.all([params, searchParams]);
  const context = await requireWorkspace(organizationSlug, "dashboard:read");
  const deps = { prisma: db() };

  // Invalid query values fall back to defaults instead of erroring the page.
  const parsed = dashboardFilterSchema.safeParse({
    projectId: first(query.projectId),
    assigneeId: first(query.assigneeId),
    range: first(query.range),
  });
  const filter = parsed.success ? parsed.data : dashboardFilterSchema.parse({});

  const [t, data, projects, members] = await Promise.all([
    getTranslations("Dashboard"),
    getDashboard(deps, context, filter),
    listProjects(deps, context),
    listActiveMembers(deps, context),
  ]);
  const filtered = Boolean(filter.projectId || filter.assigneeId);
  const isEmpty = data.activeGoals === 0 && data.totalTasks === 0 && !filtered;
  const canCreateGoal = roleHasPermission(context.role, "goal:create");
  const base = `/w/${organizationSlug}`;

  const cards: {
    key: "activeGoals" | "myOpenTasks" | "completedTasks" | "overdueTasks" | "progress";
    value: string;
  }[] = [
    { key: "activeGoals", value: String(data.activeGoals) },
    { key: "myOpenTasks", value: String(data.myOpenTasks) },
    { key: "completedTasks", value: String(data.completedTasks) },
    { key: "overdueTasks", value: String(data.overdueTasks) },
    { key: "progress", value: data.progress === null ? "—" : `${data.progress}%` },
  ];

  return (
    <WorkspaceShell context={context} active="overview">
      <h1 className="text-2xl font-semibold tracking-tight">{context.organization.name}</h1>

      <form method="get" className="flex flex-wrap items-end gap-4" aria-label={t("filters")}>
        <div className="space-y-2">
          <Label htmlFor="f-project">{t("project")}</Label>
          <select
            id="f-project"
            name="projectId"
            defaultValue={filter.projectId ?? ""}
            className={selectClass}
          >
            <option value="">{t("all")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="f-assignee">{t("assignee")}</Label>
          <select
            id="f-assignee"
            name="assigneeId"
            defaultValue={filter.assigneeId ?? ""}
            className={selectClass}
          >
            <option value="">{t("all")}</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="f-range">{t("range")}</Label>
          <select id="f-range" name="range" defaultValue={filter.range} className={selectClass}>
            {DASHBOARD_RANGES.map((value) => (
              <option key={value} value={value}>
                {t(`ranges.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">{t("apply")}</Button>
      </form>

      {isEmpty ? (
        <Card className="space-y-3">
          <p className="text-muted-foreground">
            {canCreateGoal ? t("emptyCanCreate") : t("empty")}
          </p>
          {canCreateGoal && (
            <Link
              href={`${base}/goals`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("createFirstGoal")}
            </Link>
          )}
        </Card>
      ) : (
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {cards.map((card) => (
            <Card key={card.key} className="space-y-1 p-4">
              <dt className="text-sm text-muted-foreground">{t(`cards.${card.key}`)}</dt>
              <dd className="text-3xl font-semibold tabular-nums">{card.value}</dd>
            </Card>
          ))}
        </dl>
      )}
    </WorkspaceShell>
  );
}
