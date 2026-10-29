"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/features/notifications/server/notification-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { toActionError, type ActionState } from "@/server/services/action-result";

export async function markNotificationReadAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "notification:read",
  );
  const correlationId = await getCorrelationId();
  try {
    await markNotificationRead({ prisma: db() }, context, String(formData.get("id") ?? ""));
  } catch (error) {
    return toActionError(error, correlationId, "notification.read");
  }
  revalidatePath("/[locale]/w/[organizationSlug]", "layout");
  return { ok: true };
}

export async function markAllNotificationsReadAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "notification:read",
  );
  const correlationId = await getCorrelationId();
  try {
    await markAllNotificationsRead({ prisma: db() }, context);
  } catch (error) {
    return toActionError(error, correlationId, "notification.read_all");
  }
  revalidatePath("/[locale]/w/[organizationSlug]", "layout");
  return { ok: true };
}
