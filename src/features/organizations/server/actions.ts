"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createOrganization } from "@/features/organizations/server/organization-service";

export type CreateOrganizationState = { error?: "invalid" | "conflict" | "generic" };

export async function createOrganizationAction(
  _previous: CreateOrganizationState,
  formData: FormData,
): Promise<CreateOrganizationState> {
  const locale = await getLocale();
  const user = await getSessionUser();
  if (!user?.emailVerified) return redirect({ href: "/sign-in", locale });

  const correlationId = await getCorrelationId();
  let slug: string;
  try {
    const organization = await createOrganization(
      { prisma: db(), correlationId },
      user.id,
      { name: formData.get("name"), slug: formData.get("slug") },
      { trialDays: env().BILLING_ENABLED ? env().BILLING_TRIAL_DAYS : undefined },
    );
    slug = organization.slug;
  } catch (error) {
    if (isAppError(error) && error.code === "INVALID_INPUT") return { error: "invalid" };
    if (isAppError(error) && error.code === "CONFLICT") return { error: "conflict" };
    logger.error({ err: error, correlationId }, "organization.create failed");
    return { error: "generic" };
  }
  return redirect({ href: `/w/${slug}`, locale });
}
