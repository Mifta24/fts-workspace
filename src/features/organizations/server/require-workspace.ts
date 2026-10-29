import "server-only";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
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
  try {
    return await getAuthorizedOrganization(
      { prisma: db() },
      { userId: user.id, organizationSlug, permission },
    );
  } catch (error) {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) {
      notFound();
    }
    throw error;
  }
}
