"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import {
  GOOGLE_CALLBACK_PATH,
  OAUTH_STATE_COOKIE,
} from "@/features/calendar-sync/schemas/calendar-sync";
import {
  beginGoogleConnect,
  disconnectGoogle,
} from "@/features/calendar-sync/server/calendar-sync-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { toActionError, type ActionState } from "@/server/services/action-result";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

/** Sends the person to Google's consent screen; the sealed state cookie travels with them. */
export async function connectGoogleAction(formData: FormData): Promise<void> {
  const organizationSlug = text(formData, "organizationSlug");
  const context = await requireWorkspace(organizationSlug, "booking:manage");
  const correlationId = await getCorrelationId();
  const locale = await getLocale();
  let target = `/${locale}/w/${organizationSlug}/booking?calendar=failed`;
  try {
    const { url, cookie } = beginGoogleConnect({ prisma: db(), correlationId }, context, locale);
    (await cookies()).set(OAUTH_STATE_COOKIE, cookie.value, {
      httpOnly: true,
      // Lax: the cookie must come back on Google's redirect, which is a cross-site navigation.
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: GOOGLE_CALLBACK_PATH,
      maxAge: cookie.maxAgeSeconds,
    });
    target = url;
  } catch (error) {
    logger.warn({ err: error, correlationId }, "google connect could not start");
  }
  redirect(target);
}

export async function disconnectGoogleAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "booking:manage");
  const correlationId = await getCorrelationId();
  try {
    await disconnectGoogle({ prisma: db(), correlationId }, context);
  } catch (error) {
    return toActionError(error, correlationId, "calendar.google.disconnect");
  }
  revalidatePath("/[locale]/w/[organizationSlug]/booking", "page");
  return { ok: true };
}
