"use client";

import { useTranslations } from "next-intl";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionError } from "@/server/services/action-result";

/** Localized, announced message for a failed server action. */
export function ActionErrorMessage({ error }: { error?: ActionError }) {
  const t = useTranslations("ActionErrors");
  return <FormMessage tone="error">{error ? t(error) : undefined}</FormMessage>;
}
