"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setBudgetAction } from "@/features/assistant/server/actions";
import type { ActionState } from "@/server/services/action-result";

export function BudgetForm({
  organizationSlug,
  budget,
}: {
  organizationSlug: string;
  budget: number;
}) {
  const t = useTranslations("Assistant");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<ActionState, FormData>(setBudgetAction, {});
  return (
    <form key={budget} action={action} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <div className="space-y-2">
        <Label htmlFor="budget">{t("budgetLabel")}</Label>
        <Input
          id="budget"
          name="budget"
          type="number"
          min={0}
          max={50000000}
          step={1000}
          defaultValue={budget}
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("saveBudget")}
      </Button>
      <ActionErrorMessage error={state.error} />
      <FormMessage tone="success">{state.ok ? common("saved") : undefined}</FormMessage>
    </form>
  );
}
