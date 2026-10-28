"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createOrganizationAction,
  type CreateOrganizationState,
} from "@/features/organizations/server/actions";

export function CreateOrganizationForm() {
  const t = useTranslations("Workspaces");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<CreateOrganizationState, FormData>(
    createOrganizationAction,
    {},
  );
  const error =
    state.error === "invalid"
      ? t("invalid")
      : state.error === "conflict"
        ? t("conflict")
        : state.error
          ? common("genericError")
          : undefined;

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">{t("nameLabel")}</Label>
        <Input
          id="name"
          name="name"
          required
          minLength={2}
          maxLength={80}
          autoComplete="organization"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slug">{t("slugLabel")}</Label>
        <Input
          id="slug"
          name="slug"
          required
          minLength={3}
          maxLength={48}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          aria-describedby="slug-hint"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p id="slug-hint" className="text-xs text-muted-foreground">
          {t("slugHint")}
        </p>
      </div>
      <FormMessage tone="error">{error}</FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("createSubmit")}
      </Button>
    </form>
  );
}
