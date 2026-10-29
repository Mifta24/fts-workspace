"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "@/features/organizations/server/invitation-actions";
import type { ActionState } from "@/server/services/action-result";

export function AcceptInvitationForm({ token }: { token: string }) {
  const t = useTranslations("Invitation");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<ActionState, FormData>(
    acceptInvitationAction,
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("accept")}
      </Button>
    </form>
  );
}
