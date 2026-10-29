"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TASK_PRIORITIES } from "@/features/tasks/schemas/task";
import { createTaskAction } from "@/features/tasks/server/actions";
import type { ActionState } from "@/server/services/action-result";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Option = { id: string; label: string };

export function CreateTaskForm({
  organizationSlug,
  goals,
  projects,
  members,
}: {
  organizationSlug: string;
  goals: Option[];
  projects: Option[];
  members: Option[];
}) {
  const t = useTranslations("Tasks");
  const common = useTranslations("Common");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await createTaskAction(previous, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    {},
  );

  const picker = (id: string, name: string, label: string, options: Option[]) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} name={name} defaultValue="" className={selectClass}>
        <option value="">{t("none")}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <div className="space-y-2">
        <Label htmlFor="task-title">{t("titleLabel")}</Label>
        <Input id="task-title" name="title" required minLength={2} maxLength={200} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="task-description">{t("descriptionLabel")}</Label>
        <Input id="task-description" name="description" maxLength={10000} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {picker("task-assignee", "assigneeId", t("assigneeLabel"), members)}
        {picker("task-goal", "goalId", t("goalLabel"), goals)}
        {picker("task-project", "projectId", t("projectLabel"), projects)}
        <div className="space-y-2">
          <Label htmlFor="task-priority">{t("priorityLabel")}</Label>
          <select id="task-priority" name="priority" defaultValue="MEDIUM" className={selectClass}>
            {TASK_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {t(`priority.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-due">{t("dueLabel")}</Label>
          <Input id="task-due" name="dueAt" type="date" />
        </div>
      </div>
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("createSubmit")}
      </Button>
    </form>
  );
}
