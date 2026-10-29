"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/features/tasks/schemas/task";
import { updateTaskAction } from "@/features/tasks/server/actions";
import type { ActionState } from "@/server/services/action-result";

type Option = { id: string; label: string };

export type EditableTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeId: string | null;
  goalId: string | null;
  projectId: string | null;
  dueDate: string;
};

export function EditTaskForm({
  organizationSlug,
  task,
  goals,
  projects,
  members,
}: {
  organizationSlug: string;
  task: EditableTask;
  goals: Option[];
  projects: Option[];
  members: Option[];
}) {
  const t = useTranslations("Tasks");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<ActionState, FormData>(updateTaskAction, {});

  const picker = (id: string, name: string, label: string, options: Option[], value: string) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} name={name} defaultValue={value}>
        <option value="">{t("none")}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="id" value={task.id} />
      <div className="space-y-2">
        <Label htmlFor="task-title">{t("titleLabel")}</Label>
        <Input
          id="task-title"
          name="title"
          defaultValue={task.title}
          required
          minLength={2}
          maxLength={200}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="task-description">{t("descriptionLabel")}</Label>
        <Input
          id="task-description"
          name="description"
          defaultValue={task.description ?? ""}
          maxLength={10000}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="status">{t("statusLabel")}</Label>
          <Select id="status" name="status" defaultValue={task.status}>
            {TASK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="priority">{t("priorityLabel")}</Label>
          <Select id="priority" name="priority" defaultValue={task.priority}>
            {TASK_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {t(`priority.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        {picker("task-assignee", "assigneeId", t("assigneeLabel"), members, task.assigneeId ?? "")}
        {picker("task-goal", "goalId", t("goalLabel"), goals, task.goalId ?? "")}
        {picker("task-project", "projectId", t("projectLabel"), projects, task.projectId ?? "")}
        <div className="space-y-2">
          <Label htmlFor="task-due">{t("dueLabel")}</Label>
          <Input id="task-due" name="dueAt" type="date" defaultValue={task.dueDate} />
        </div>
      </div>
      <ActionErrorMessage error={state.error} />
      <FormMessage tone="success">{state.ok ? common("saved") : undefined}</FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("save")}
      </Button>
    </form>
  );
}
