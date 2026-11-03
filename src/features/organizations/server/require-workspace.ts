import "server-only";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { mfaRequired } from "@/features/auth/server/mfa-policy";
import { redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions/matrix";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";

/**
 * Page/action guard: verified session + active membership + permission.
 * Redirects anonymous users to sign-in and renders 404 for inaccessible tenants.
 */
export async function requireWorkspace(
  organizationSlug: string,
  permission: Permission,
): Promise<OrganizationContext> {
  const locale = await getLocale();
  const user = await getSessionUser();
  if (!user?.emailVerified) return redirect({ href: "/sign-in", locale });
  let context: OrganizationContext;
  try {
    context = await getAuthorizedOrganization(
      { prisma: db() },
      { userId: user.id, organizationSlug, permission },
    );
  } catch (error) {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) {
      notFound();
    }
    throw error;
  }
  // Only after the membership is known, so a stranger still gets a plain 404.
  if (
    mfaRequired({
      twoFactorEnabled: user.twoFactorEnabled,
      isOwner: context.role === "OWNER",
      ownersRequired: env().MFA_REQUIRED_FOR_OWNERS,
    })
  ) {
    return redirect({ href: "/security?required=owner", locale });
  }
  return context;
}
