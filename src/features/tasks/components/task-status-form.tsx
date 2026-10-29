"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/features/tasks/schemas/task";
import { updateTaskAction } from "@/features/tasks/server/actions";
import type { ActionState } from "@/server/services/action-result";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function TaskStatusForm({
  organizationSlug,
  taskId,
  status,
  priority,
}: {
  organizationSlug: string;
  taskId: string;
  status: string;
  priority: string;
}) {
  const t = useTranslations("Tasks");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<ActionState, FormData>(updateTaskAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="id" value={taskId} />
      <div className="space-y-2">
        <Label htmlFor="status">{t("statusLabel")}</Label>
        <select id="status" name="status" defaultValue={status} className={selectClass}>
          {TASK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="priority">{t("priorityLabel")}</Label>
        <select id="priority" name="priority" defaultValue={priority} className={selectClass}>
          {TASK_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {t(`priority.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("save")}
      </Button>
      <ActionErrorMessage error={state.error} />
    </form>
  );
}
