import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { EditGoalForm } from "@/features/goals/components/edit-goal-form";
import { getGoal, listGoals } from "@/features/goals/server/goal-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { listActiveMembers } from "@/features/organizations/server/organization-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { listProjects } from "@/features/projects/server/project-service";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";

export default async function EditGoalPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/goals/[goalId]">) {
  const { organizationSlug, goalId } = await params;
  const context = await requireWorkspace(organizationSlug, "goal:update");
  const deps = { prisma: db() };
  const goal = await getGoal(deps, context, goalId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  // Archived goals are read-only; treat them like missing ones here.
  if (goal.status === "ARCHIVED") notFound();

  const [t, goals, projects, members] = await Promise.all([
    getTranslations("Goals"),
    listGoals(deps, context),
    listProjects(deps, context),
    listActiveMembers(deps, context),
  ]);

  return (
    <WorkspaceShell context={context} active="goals">
      <Link href={`/w/${organizationSlug}/goals`} className="text-sm text-primary hover:underline">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("editTitle")}</h1>
      <Card>
        <EditGoalForm
          organizationSlug={organizationSlug}
          goal={{
            ...goal,
            status: goal.status,
            dueDate: goal.dueAt ? goal.dueAt.toISOString().slice(0, 10) : "",
          }}
          projects={projects.map((project) => ({ id: project.id, label: project.name }))}
          // Descendants are rejected by the service; the goal itself is never offered.
          parentGoals={goals
            .filter((other) => other.id !== goal.id)
            .map((other) => ({ id: other.id, label: other.title }))}
          members={members.map((member) => ({ id: member.userId, label: member.name }))}
        />
      </Card>
    </WorkspaceShell>
  );
}
