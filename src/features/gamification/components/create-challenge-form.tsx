"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createChallengeAction } from "@/features/gamification/server/actions";
import type { ActionState } from "@/server/services/action-result";

export function CreateChallengeForm({ organizationSlug }: { organizationSlug: string }) {
  const t = useTranslations("Progress");
  const common = useTranslations("Common");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await createChallengeAction(previous, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    {},
  );
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <div className="space-y-2">
        <Label htmlFor="challenge-title">{t("challengeTitle")}</Label>
        <Input id="challenge-title" name="title" required minLength={2} maxLength={120} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="challenge-description">{t("challengeDescription")}</Label>
        <Input id="challenge-description" name="description" maxLength={1000} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="challenge-target">{t("challengeTarget")}</Label>
          <Input id="challenge-target" name="target" type="number" min={1} max={1000} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="challenge-start">{t("challengeStart")}</Label>
          <Input id="challenge-start" name="startsAt" type="date" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="challenge-end">{t("challengeEnd")}</Label>
          <Input id="challenge-end" name="endsAt" type="date" required />
        </div>
      </div>
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("createChallenge")}
      </Button>
    </form>
  );
}
