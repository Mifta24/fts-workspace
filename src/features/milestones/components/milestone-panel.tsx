"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addMilestoneAction,
  deleteMilestoneAction,
  toggleMilestoneAction,
} from "@/features/milestones/server/actions";
import type { ActionState } from "@/server/services/action-result";

export type MilestoneItem = {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
};

type Props = { organizationSlug: string; goalId: string; milestones: MilestoneItem[] };

export function MilestonePanel({ organizationSlug, goalId, milestones }: Props) {
  const t = useTranslations("Milestones");
  return (
    <div className="space-y-4">
      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {milestones.map((milestone) => (
            <li
              key={milestone.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div>
                <p className={milestone.completed ? "font-medium line-through" : "font-medium"}>
                  {milestone.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    milestone.completed ? t("done") : t("open"),
                    milestone.dueDate ? t("due", { date: milestone.dueDate }) : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <MilestoneButton
                  action={toggleMilestoneAction}
                  organizationSlug={organizationSlug}
                  id={milestone.id}
                  extra={{ completed: String(!milestone.completed) }}
                  label={milestone.completed ? t("reopen") : t("complete")}
                />
                <MilestoneButton
                  action={deleteMilestoneAction}
                  organizationSlug={organizationSlug}
                  id={milestone.id}
                  label={t("delete")}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <AddMilestoneForm organizationSlug={organizationSlug} goalId={goalId} />
    </div>
  );
}

function MilestoneButton({
  action,
  organizationSlug,
  id,
  label,
  extra = {},
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  organizationSlug: string;
  id: string;
  label: string;
  extra?: Record<string, string>;
}) {
  const common = useTranslations("Common");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? common("loading") : label}
      </Button>
      <ActionErrorMessage error={state.error} />
    </form>
  );
}

function AddMilestoneForm({
  organizationSlug,
  goalId,
}: {
  organizationSlug: string;
  goalId: string;
}) {
  const t = useTranslations("Milestones");
  const common = useTranslations("Common");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await addMilestoneAction(previous, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    {},
  );
  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="goalId" value={goalId} />
      <div className="space-y-2">
        <Label htmlFor="milestone-title">{t("titleLabel")}</Label>
        <Input id="milestone-title" name="title" required minLength={2} maxLength={160} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="milestone-due">{t("dueLabel")}</Label>
        <Input id="milestone-due" name="dueAt" type="date" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("add")}
      </Button>
      <ActionErrorMessage error={state.error} />
    </form>
  );
}
