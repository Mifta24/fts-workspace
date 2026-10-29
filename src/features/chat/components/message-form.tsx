"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { postMessageAction } from "@/features/chat/server/actions";
import type { ActionState } from "@/server/services/action-result";

export function MessageForm({
  organizationSlug,
  channelId,
}: {
  organizationSlug: string;
  channelId: string;
}) {
  const t = useTranslations("Chat");
  const common = useTranslations("Common");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await postMessageAction(previous, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    {},
  );
  return (
    <form ref={formRef} action={action} className="space-y-2">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="channelId" value={channelId} />
      <Label htmlFor="message-body">{t("messageLabel")}</Label>
      <textarea
        id="message-body"
        name="body"
        required
        maxLength={4000}
        rows={2}
        className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("send")}
      </Button>
    </form>
  );
}
