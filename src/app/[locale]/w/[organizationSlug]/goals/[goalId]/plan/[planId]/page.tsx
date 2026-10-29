import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { PlanReviewForm } from "@/features/ai-planner/components/plan-review-form";
import { getPlan } from "@/features/ai-planner/server/plan-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";

export default async function PlanReviewPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/goals/[goalId]/plan/[planId]">) {
  const { organizationSlug, goalId, planId } = await params;
  const context = await requireWorkspace(organizationSlug, "ai:use");
  const plan = await getPlan({ prisma: db() }, context, planId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  // The URL's goal must match the plan's goal, so a plan cannot be shown under a different goal.
  if (plan.goalId !== goalId) notFound();
  const t = await getTranslations("AiPlanner");

  return (
    <WorkspaceShell context={context} active="goals">
      <Link
        href={`/w/${organizationSlug}/goals/${goalId}`}
        className="text-sm text-primary hover:underline"
      >
        {t("backToGoal")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("reviewTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("reviewIntro")}</p>
      {plan.status !== "DRAFT" ? (
        <Card>
          <p role="status" className="text-muted-foreground">
            {t(plan.status === "APPLIED" ? "alreadyApplied" : "alreadyDiscarded")}
          </p>
        </Card>
      ) : plan.tasks.length === 0 ? (
        <Card>
          <p role="status" className="text-muted-foreground">
            {t("emptyDraft")}
          </p>
        </Card>
      ) : (
        <PlanReviewForm
          organizationSlug={organizationSlug}
          goalId={goalId}
          planId={plan.id}
          tasks={plan.tasks}
        />
      )}
    </WorkspaceShell>
  );
}
