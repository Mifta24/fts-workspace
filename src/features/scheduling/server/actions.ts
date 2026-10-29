"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import {
  cancelAppointment,
  createAppointment,
  rescheduleAppointment,
  respondToAppointment,
} from "@/features/scheduling/server/scheduling-service";
import { toActionError, type ActionState } from "@/server/services/action-result";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const refresh = () => revalidatePath("/[locale]/w/[organizationSlug]/schedule", "page");

export async function createAppointmentAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "appointment:write");
  const correlationId = await getCorrelationId();
  try {
    await createAppointment({ prisma: db(), correlationId }, context, {
      title: formData.get("title"),
      description: formData.get("description"),
      location: formData.get("location"),
      // The form's date and time are UTC (the page says so).
      startsAt: formData.get("startsAt") ? `${text(formData, "startsAt")}Z` : "",
      durationMinutes: formData.get("durationMinutes"),
      attendeeIds: formData.getAll("attendeeIds").map(String),
      contactId: formData.get("contactId"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "appointment.create");
  }
  refresh();
  return { ok: true };
}

export async function respondAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "appointment:read");
  const correlationId = await getCorrelationId();
  try {
    await respondToAppointment(
      { prisma: db(), correlationId },
      context,
      text(formData, "id"),
      formData.get("response"),
    );
  } catch (error) {
    return toActionError(error, correlationId, "appointment.respond");
  }
  refresh();
  return { ok: true };
}

export async function rescheduleAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "appointment:write");
  const correlationId = await getCorrelationId();
  try {
    await rescheduleAppointment({ prisma: db(), correlationId }, context, text(formData, "id"), {
      startsAt: formData.get("startsAt") ? `${text(formData, "startsAt")}Z` : "",
      durationMinutes: formData.get("durationMinutes"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "appointment.reschedule");
  }
  refresh();
  return { ok: true };
}

export async function cancelAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "appointment:write");
  const correlationId = await getCorrelationId();
  try {
    await cancelAppointment({ prisma: db(), correlationId }, context, text(formData, "id"));
  } catch (error) {
    return toActionError(error, correlationId, "appointment.cancel");
  }
  refresh();
  return { ok: true };
}
