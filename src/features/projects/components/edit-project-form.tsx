"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProjectAction } from "@/features/projects/server/actions";
import type { ActionState } from "@/server/services/action-result";

export function EditProjectForm({
  organizationSlug,
  project,
}: {
  organizationSlug: string;
  project: { id: string; name: string; description: string | null };
}) {
  const t = useTranslations("Projects");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProjectAction, {});
  return (
    <form
      key={JSON.stringify([project.name, project.description])}
      action={action}
      className="space-y-4"
    >
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="id" value={project.id} />
      <div className="space-y-2">
        <Label htmlFor="project-name">{t("nameLabel")}</Label>
        <Input
          id="project-name"
          name="name"
          defaultValue={project.name}
          required
          minLength={2}
          maxLength={120}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="project-description">{t("descriptionLabel")}</Label>
        <Input
          id="project-description"
          name="description"
          defaultValue={project.description ?? ""}
          maxLength={2000}
        />
      </div>
      <ActionErrorMessage error={state.error} />
      <FormMessage tone="success">{state.ok ? common("saved") : undefined}</FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("save")}
      </Button>
    </form>
  );
}
