"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createChannelAction } from "@/features/chat/server/actions";
import type { ActionState } from "@/server/services/action-result";

export function CreateChannelForm({ organizationSlug }: { organizationSlug: string }) {
  const t = useTranslations("Chat");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<ActionState, FormData>(createChannelAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <div className="space-y-2">
        <Label htmlFor="channel-name">{t("channelName")}</Label>
        <Input
          id="channel-name"
          name="name"
          required
          minLength={2}
          maxLength={39}
          pattern="[a-z0-9][a-z0-9\-]{1,38}"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="channel-name-hint"
        />
        <p id="channel-name-hint" className="text-xs text-muted-foreground">
          {t("channelNameHint")}
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPrivate" className="size-4" />
        {t("private")}
      </label>
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("createChannel")}
      </Button>
    </form>
  );
}
