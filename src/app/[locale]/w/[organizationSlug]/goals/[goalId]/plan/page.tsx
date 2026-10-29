import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { ObjectiveForm } from "@/features/ai-planner/components/objective-form";
import { getGoal } from "@/features/goals/server/goal-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { getTaskPlanProvider } from "@/server/ai/provider";

export default async function PlanGoalPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/goals/[goalId]/plan">) {
  const { organizationSlug, goalId } = await params;
  const context = await requireWorkspace(organizationSlug, "ai:use");
  const goal = await getGoal({ prisma: db() }, context, goalId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  if (goal.status === "ARCHIVED") notFound();
  const t = await getTranslations("AiPlanner");
  const configured = getTaskPlanProvider() !== null;

  return (
    <WorkspaceShell context={context} active="goals">
      <Link
        href={`/w/${organizationSlug}/goals/${goal.id}`}
        className="text-sm text-primary hover:underline"
      >
        {t("backToGoal")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title", { goal: goal.title })}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <Card>
        {configured ? (
          <ObjectiveForm organizationSlug={organizationSlug} goalId={goal.id} />
        ) : (
          <p role="status" className="text-muted-foreground">
            {t("notConfigured")}
          </p>
        )}
      </Card>
    </WorkspaceShell>
  );
}
