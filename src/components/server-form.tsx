"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef, type ReactNode } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/server/services/action-result";

type Props = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /** Hidden fields, for example the workspace slug and the target id. */
  fields: Record<string, string>;
  submitLabel: string;
  resetOnSuccess?: boolean;
  showSaved?: boolean;
  className?: string;
  children: ReactNode;
};

/** A form around a server action with a localized error line; inputs are passed as children. */
export function ServerForm({
  action,
  fields,
  submitLabel,
  resetOnSuccess = true,
  showSaved = false,
  className,
  children,
}: Props) {
  const common = useTranslations("Common");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await action(previous, formData);
      if (result.ok && resetOnSuccess) formRef.current?.reset();
      return result;
    },
    {},
  );
  return (
    <form ref={formRef} action={formAction} className={className ?? "space-y-4"}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <ActionErrorMessage error={state.error} />
      {showSaved && (
        <FormMessage tone="success">{state.ok ? common("saved") : undefined}</FormMessage>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : submitLabel}
      </Button>
    </form>
  );
}
