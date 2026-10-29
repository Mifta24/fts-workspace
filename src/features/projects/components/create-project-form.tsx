"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProjectAction } from "@/features/projects/server/actions";
import type { ActionState } from "@/server/services/action-result";

export function CreateProjectForm({ organizationSlug }: { organizationSlug: string }) {
  const t = useTranslations("Projects");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<ActionState, FormData>(createProjectAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <div className="space-y-2">
        <Label htmlFor="project-name">{t("nameLabel")}</Label>
        <Input id="project-name" name="name" required minLength={2} maxLength={120} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="project-description">{t("descriptionLabel")}</Label>
        <Input id="project-description" name="description" maxLength={2000} />
      </div>
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("createSubmit")}
      </Button>
    </form>
  );
}
