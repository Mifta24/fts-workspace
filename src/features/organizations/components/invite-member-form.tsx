"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { INVITABLE_ROLES } from "@/features/organizations/schemas/organization";
import { inviteMemberAction } from "@/features/organizations/server/invitation-actions";
import type { ActionState } from "@/server/services/action-result";

export function InviteMemberForm({ organizationSlug }: { organizationSlug: string }) {
  const t = useTranslations("Members");
  const roles = useTranslations("Roles");
  const common = useTranslations("Common");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await inviteMemberAction(previous, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    {},
  );
  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <div className="space-y-2">
        <Label htmlFor="invite-email">{t("emailLabel")}</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-role">{t("roleLabel")}</Label>
        <Select id="invite-role" name="role" defaultValue="MEMBER">
          {INVITABLE_ROLES.map((role) => (
            <option key={role} value={role}>
              {roles(role)}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("invite")}
      </Button>
      <ActionErrorMessage error={state.error} />
      <FormMessage tone="success">{state.ok ? t("invited") : undefined}</FormMessage>
    </form>
  );
}
