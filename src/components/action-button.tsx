"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/server/services/action-result";

type Props = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /** Hidden form fields, for example the workspace slug and the target id. */
  fields: Record<string, string>;
  label: string;
  variant?: "default" | "outline" | "ghost";
};

/** A single-purpose form button for server actions that only need a few hidden fields. */
export function ActionButton({ action, fields, label, variant = "outline" }: Props) {
  const common = useTranslations("Common");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size="sm" disabled={pending}>
        {pending ? common("loading") : label}
      </Button>
      <ActionErrorMessage error={state.error} />
    </form>
  );
}
