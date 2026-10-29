"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef, useState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createGoalAction } from "@/features/goals/server/actions";
import { PROGRESS_MODES } from "@/features/goals/schemas/goal";
import type { ActionState } from "@/server/services/action-result";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Option = { id: string; label: string };

export function CreateGoalForm({
  organizationSlug,
  projects,
  parentGoals,
}: {
  organizationSlug: string;
  projects: Option[];
  parentGoals: Option[];
}) {
  const t = useTranslations("Goals");
  const common = useTranslations("Common");
  const [mode, setMode] = useState<(typeof PROGRESS_MODES)[number]>("MANUAL");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await createGoalAction(previous, formData);
      if (result.ok) {
        formRef.current?.reset();
        setMode("MANUAL");
      }
      return result;
    },
    {},
  );

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <div className="space-y-2">
        <Label htmlFor="goal-title">{t("titleLabel")}</Label>
        <Input id="goal-title" name="title" required minLength={2} maxLength={160} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="goal-description">{t("descriptionLabel")}</Label>
        <Input id="goal-description" name="description" maxLength={4000} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="goal-project">{t("projectLabel")}</Label>
          <select id="goal-project" name="projectId" defaultValue="" className={selectClass}>
            <option value="">{t("none")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-parent">{t("parentLabel")}</Label>
          <select id="goal-parent" name="parentGoalId" defaultValue="" className={selectClass}>
            <option value="">{t("none")}</option>
            {parentGoals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-mode">{t("modeLabel")}</Label>
          <select
            id="goal-mode"
            name="progressMode"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
            className={selectClass}
          >
            {PROGRESS_MODES.map((value) => (
              <option key={value} value={value}>
                {t(`mode.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-due">{t("dueLabel")}</Label>
          <Input id="goal-due" name="dueAt" type="date" />
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
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-current">{t("currentLabel")}</Label>
              <Input id="goal-current" name="currentValue" type="number" min={0} step="any" />
            </div>
          </>
        )}
      </div>
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("createSubmit")}
      </Button>
    </form>
  );
}
