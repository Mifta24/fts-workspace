"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { generatePlanAction } from "@/features/ai-planner/server/actions";
import type { ActionState } from "@/server/services/action-result";

export function ObjectiveForm({
  organizationSlug,
  goalId,
}: {
  organizationSlug: string;
  goalId: string;
}) {
  const t = useTranslations("AiPlanner");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<ActionState, FormData>(generatePlanAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="goalId" value={goalId} />
      <Label htmlFor="objective">{t("objectiveLabel")}</Label>
      <textarea
        id="objective"
        name="objective"
        required
        minLength={10}
        maxLength={2000}
        rows={4}
        aria-describedby="objective-hint"
        className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p id="objective-hint" className="text-xs text-muted-foreground">
        {t("objectiveHint")}
      </p>
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("generate")}
      </Button>
    </form>
  );
}
