"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { cancelBookingAction } from "@/features/booking/server/actions";
import type { ActionState } from "@/server/services/action-result";

/** One button; cancelling is a POST so a mail scanner opening the link cannot cancel anything. */
export function CancelBookingForm({ token }: { token: string }) {
  const t = useTranslations("PublicBooking");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelBookingAction, {});

  if (state.ok) {
    return (
      <p role="status" className="rounded-md border border-border bg-card p-4">
        {t("cancelled")}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <ActionErrorMessage error={state.error} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? common("loading") : t("cancelBooking")}
      </Button>
    </form>
  );
}
