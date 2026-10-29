"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/server/services/action-result";

type Props = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  organizationSlug: string;
  id: string;
  label: string;
};

export function ArchiveButton({ action, organizationSlug, id, label }: Props) {
  const common = useTranslations("Common");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? common("loading") : label}
      </Button>
      <ActionErrorMessage error={state.error} />
    </form>
  );
}
