"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EDITABLE_GOAL_STATUSES, PROGRESS_MODES } from "@/features/goals/schemas/goal";
import { updateGoalAction } from "@/features/goals/server/actions";
import type { ActionState } from "@/server/services/action-result";

type Option = { id: string; label: string };

export type EditableGoal = {
  id: string;
  title: string;
  description: string | null;
  projectId: string | null;
  parentGoalId: string | null;
  ownerId: string;
  status: "ACTIVE" | "COMPLETED";
  progressMode: (typeof PROGRESS_MODES)[number];
  manualProgress: number | null;
  targetValue: number | null;
  currentValue: number | null;
  dueDate: string;
};

export function EditGoalForm({
  organizationSlug,
  goal,
  projects,
  parentGoals,
  members,
}: {
  organizationSlug: string;
  goal: EditableGoal;
  projects: Option[];
  parentGoals: Option[];
  members: Option[];
}) {
  const t = useTranslations("Goals");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<ActionState, FormData>(updateGoalAction, {});
  const [mode, setMode] = useState(goal.progressMode);

  const picker = (
    id: string,
    name: string,
    label: string,
    options: Option[],
    value: string,
    allowNone = true,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} name={name} defaultValue={value}>
        {allowNone && <option value="">{t("none")}</option>}
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
      <input type="hidden" name="id" value={goal.id} />
      <div className="space-y-2">
        <Label htmlFor="goal-title">{t("titleLabel")}</Label>
        <Input
          id="goal-title"
          name="title"
          defaultValue={goal.title}
          required
          minLength={2}
          maxLength={160}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="goal-description">{t("descriptionLabel")}</Label>
        <Input
          id="goal-description"
          name="description"
          defaultValue={goal.description ?? ""}
          maxLength={4000}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {picker("goal-project", "projectId", t("projectLabel"), projects, goal.projectId ?? "")}
        {picker(
          "goal-parent",
          "parentGoalId",
          t("parentLabel"),
          parentGoals,
          goal.parentGoalId ?? "",
        )}
        {picker("goal-owner", "ownerId", t("ownerLabel"), members, goal.ownerId, false)}
        <div className="space-y-2">
          <Label htmlFor="goal-status">{t("statusLabel")}</Label>
          <Select id="goal-status" name="status" defaultValue={goal.status}>
            {EDITABLE_GOAL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-mode">{t("modeLabel")}</Label>
          <Select
            id="goal-mode"
            name="progressMode"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            {PROGRESS_MODES.map((value) => (
              <option key={value} value={value}>
                {t(`mode.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-due">{t("dueLabel")}</Label>
          <Input id="goal-due" name="dueAt" type="date" defaultValue={goal.dueDate} />
        </div>
        {mode === "MANUAL" && (
          <div className="space-y-2">
            <Label htmlFor="goal-manual">{t("manualLabel")}</Label>
            <Input
              id="goal-manual"
              name="manualProgress"
              type="number"
              min={0}
              max={100}
              step={1}
              defaultValue={goal.manualProgress ?? ""}
            />
          </div>
        )}
        {mode === "NUMERIC_KPI" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="goal-target">{t("targetLabel")}</Label>
              <Input
                id="goal-target"
                name="targetValue"
                type="number"
                min={0}
                step="any"
                defaultValue={goal.targetValue ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-current">{t("currentLabel")}</Label>
              <Input
                id="goal-current"
                name="currentValue"
                type="number"
                min={0}
                step="any"
                defaultValue={goal.currentValue ?? ""}
              />
            </div>
          </>
        )}
      </div>
      <ActionErrorMessage error={state.error} />
      <FormMessage tone="success">{state.ok ? common("saved") : undefined}</FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("save")}
      </Button>
    </form>
  );
}
