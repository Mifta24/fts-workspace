import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { AskForm } from "@/features/assistant/components/ask-form";
import { BudgetForm } from "@/features/assistant/components/budget-form";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";
import { getTaskPlanProvider } from "@/server/ai/provider";
import { getAiUsage } from "@/server/ai/usage";

export default async function AssistantPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/assistant">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "ai:use");
  const [t, usage] = await Promise.all([getTranslations("Assistant"), getAiUsage(db(), context)]);
  const configured = getTaskPlanProvider() !== null;
  const canSetBudget = roleHasPermission(context.role, "organization:update");

  return (
    <WorkspaceShell context={context} active="assistant">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <Card>
        {configured ? (
          <AskForm organizationSlug={organizationSlug} />
        ) : (
          <p role="status" className="text-muted-foreground">
            {t("notConfigured")}
          </p>
        )}
      </Card>
      <Card className="space-y-3">
        <CardTitle className="text-lg">{t("usageTitle")}</CardTitle>
        <p className="text-sm tabular-nums">
          {t("usage", {
            used: usage.usedToday.toLocaleString("en"),
            budget: usage.dailyBudget.toLocaleString("en"),
          })}
        </p>
        {canSetBudget && (
          <BudgetForm organizationSlug={organizationSlug} budget={usage.dailyBudget} />
        )}
      </Card>
    </WorkspaceShell>
  );
}
