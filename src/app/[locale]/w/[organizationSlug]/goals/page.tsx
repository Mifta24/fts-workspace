import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { CreateGoalForm } from "@/features/goals/components/create-goal-form";
import { GoalTree } from "@/features/goals/components/goal-tree";
import { listGoals } from "@/features/goals/server/goal-service";
import { buildGoalTree } from "@/features/goals/server/tree";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { listProjects } from "@/features/projects/server/project-service";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";

export default async function GoalsPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/goals">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "goal:read");
  const deps = { prisma: db() };
  const [t, goals, projects] = await Promise.all([
    getTranslations("Goals"),
    listGoals(deps, context),
    listProjects(deps, context),
  ]);
  const canCreate = roleHasPermission(context.role, "goal:create");
  const canArchive = roleHasPermission(context.role, "goal:archive");
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <WorkspaceShell context={context} active="goals">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      {goals.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{canCreate ? t("empty") : t("emptyReadOnly")}</p>
        </Card>
      ) : (
        <GoalTree
          nodes={buildGoalTree(goals)}
          organizationSlug={organizationSlug}
          canArchive={canArchive}
          projectNames={projectNames}
        />
      )}
      {canCreate && (
        <Card>
          <CardTitle className="mb-4 text-lg">{t("createTitle")}</CardTitle>
          <CreateGoalForm
            organizationSlug={organizationSlug}
            projects={projects.map((project) => ({ id: project.id, label: project.name }))}
            parentGoals={goals
              .filter((goal) => goal.status !== "ARCHIVED")
              .map((goal) => ({ id: goal.id, label: goal.title }))}
          />
        </Card>
      )}
    </WorkspaceShell>
  );
}
