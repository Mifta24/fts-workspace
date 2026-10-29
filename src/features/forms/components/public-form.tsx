"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { HONEYPOT_FIELD, type FieldDef } from "@/features/forms/schemas/forms";
import { submitFormAction } from "@/features/forms/server/actions";
import type { ActionState } from "@/server/services/action-result";

export function PublicFormClient({
  token,
  fields,
  consentText,
}: {
  token: string;
  fields: FieldDef[];
  consentText: string | null;
}) {
  const t = useTranslations("PublicForm");
  const common = useTranslations("Common");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await submitFormAction(previous, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    {},
  );

  if (state.ok) {
    return (
      <p role="status" className="rounded-md border border-border bg-card p-4">
        {t("thanks")}
      </p>
    );
  }

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {fields.map((field) => {
        const id = `field-${field.key}`;
        return (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={id}>
              {field.label}
              {field.required ? ` (${t("required")})` : ""}
            </Label>
            {field.type === "textarea" ? (
              <textarea
                id={id}
                name={field.key}
                required={field.required}
                maxLength={2000}
                rows={4}
                className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : field.type === "select" ? (
              <Select id={id} name={field.key} required={field.required} defaultValue="">
                <option value="" disabled={field.required}>
                  {t("choose")}
                </option>
                {field.options!.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={id}
                name={field.key}
                type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
                required={field.required}
                maxLength={field.type === "email" ? 254 : field.type === "phone" ? 40 : 500}
              />
            )}
          </div>
        );
      })}
      {/* Honeypot: invisible to people and assistive technology, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {consentText && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" required className="mt-1 size-4" />
          <span>{consentText}</span>
        </label>
      )}
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("submit")}
      </Button>
    </form>
  );
}
