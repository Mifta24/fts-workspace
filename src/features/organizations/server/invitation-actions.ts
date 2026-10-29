"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  acceptInvitation,
  createInvitation,
  revokeInvitation,
} from "@/features/organizations/server/invitation-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { toActionError, type ActionState } from "@/server/services/action-result";

const MEMBERS_PATH = "/[locale]/w/[organizationSlug]/members";

export async function inviteMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "member:invite",
  );
  const correlationId = await getCorrelationId();
  try {
    await createInvitation(
      { prisma: db(), correlationId },
      context,
      { email: formData.get("email"), role: formData.get("role") },
      { baseUrl: env().BETTER_AUTH_URL, locale: await getLocale() },
    );
  } catch (error) {
    return toActionError(error, correlationId, "invitation.create");
  }
  revalidatePath(MEMBERS_PATH, "page");
  return { ok: true };
}

export async function revokeInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "member:invite",
  );
  const correlationId = await getCorrelationId();
  try {
    await revokeInvitation(
      { prisma: db(), correlationId },
      context,
      String(formData.get("id") ?? ""),
    );
  } catch (error) {
    return toActionError(error, correlationId, "invitation.revoke");
  }
  revalidatePath(MEMBERS_PATH, "page");
  return { ok: true };
}

export async function acceptInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const locale = await getLocale();
  const user = await getSessionUser();
  if (!user) return redirect({ href: "/sign-in", locale });
  const correlationId = await getCorrelationId();
  let slug: string;
  try {
    ({ organizationSlug: slug } = await acceptInvitation(
      { prisma: db(), correlationId },
      user,
      String(formData.get("token") ?? ""),
    ));
  } catch (error) {
    return toActionError(error, correlationId, "invitation.accept");
  }
  return redirect({ href: `/w/${slug}`, locale });
}
