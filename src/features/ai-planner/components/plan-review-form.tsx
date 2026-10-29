"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TASK_PRIORITIES } from "@/features/tasks/schemas/task";
import { applyPlanAction, discardPlanAction } from "@/features/ai-planner/server/actions";
import type { SuggestedTask } from "@/features/ai-planner/schemas/plan";
import type { ActionState } from "@/server/services/action-result";

export function PlanReviewForm({
  organizationSlug,
  goalId,
  planId,
  tasks,
}: {
  organizationSlug: string;
  goalId: string;
  planId: string;
  tasks: SuggestedTask[];
}) {
  const t = useTranslations("AiPlanner");
  const tasksT = useTranslations("Tasks");
  const common = useTranslations("Common");
  const [state, applyAction, applying] = useActionState<ActionState, FormData>(applyPlanAction, {});
  const [discardState, discardAction, discarding] = useActionState<ActionState, FormData>(
    discardPlanAction,
    {},
  );

  return (
    <div className="space-y-4">
      <form action={applyAction} className="space-y-4">
        <input type="hidden" name="organizationSlug" value={organizationSlug} />
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="count" value={tasks.length} />
        <ul className="space-y-3">
          {tasks.map((task, index) => (
            <li
              key={index}
              className="grid items-center gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-[auto_1fr_auto_auto]"
            >
              <input
                type="checkbox"
                name={`include-${index}`}
                defaultChecked
                aria-label={t("include", { index: index + 1 })}
                className="size-4"
              />
              <Input
                name={`title-${index}`}
                defaultValue={task.title}
                required
                minLength={2}
                maxLength={200}
                aria-label={t("taskTitle", { index: index + 1 })}
              />
              <Select
                name={`priority-${index}`}
                defaultValue={task.priority}
                aria-label={t("taskPriority", { index: index + 1 })}
                className="sm:w-32"
              >
                {TASK_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {tasksT(`priority.${value}`)}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t("days")}
                <Input
                  name={`days-${index}`}
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={task.estimatedDays ?? ""}
                  className="w-20"
                />
              </label>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("estimateNote")}</p>
        <ActionErrorMessage error={state.error} />
        <Button type="submit" disabled={applying || discarding}>
          {applying ? common("loading") : t("apply")}
        </Button>
      </form>
      <form action={discardAction} className="flex items-center gap-3">
        <input type="hidden" name="organizationSlug" value={organizationSlug} />
        <input type="hidden" name="goalId" value={goalId} />
        <input type="hidden" name="planId" value={planId} />
        <Button type="submit" variant="outline" disabled={applying || discarding}>
          {discarding ? common("loading") : t("discard")}
        </Button>
        <ActionErrorMessage error={discardState.error} />
      </form>
    </div>
  );
}
