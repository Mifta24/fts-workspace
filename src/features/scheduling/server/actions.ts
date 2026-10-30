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
  resolveLocalStart,
  setTimeZone,
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
    const deps = { prisma: db(), correlationId };
    await createAppointment(deps, context, {
      title: formData.get("title"),
      description: formData.get("description"),
      location: formData.get("location"),
      // Typed in the caller's own time zone; the service converts it to UTC.
      startsAt: await resolveLocalStart(deps, context, text(formData, "startsAt")),
      durationMinutes: formData.get("durationMinutes"),
      reminderMinutes: formData.get("reminderMinutes"),
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
    const deps = { prisma: db(), correlationId };
    await rescheduleAppointment(deps, context, text(formData, "id"), {
      startsAt: await resolveLocalStart(deps, context, text(formData, "startsAt")),
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

export async function setTimeZoneAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "appointment:read");
  const correlationId = await getCorrelationId();
  try {
    await setTimeZone({ prisma: db(), correlationId }, context, formData.get("timeZone"));
  } catch (error) {
    return toActionError(error, correlationId, "appointment.timezone");
  }
  refresh();
  return { ok: true };
}
