"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { HONEYPOT_FIELD } from "@/features/booking/schemas/booking";
import {
  bookPublicSlot,
  createBookingPage,
  setBookingPageStatus,
  updateBookingPage,
} from "@/features/booking/server/booking-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { CAPTCHA_FIELD, verifyCaptcha } from "@/server/security/captcha";
import { requestIp } from "@/server/security/request-ip";
import { toActionError, type ActionState } from "@/server/services/action-result";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const refresh = () => revalidatePath("/[locale]/w/[organizationSlug]/booking", "layout");

/** The form fields shared by creating and editing a page. */
function settingsFrom(formData: FormData) {
  return {
    title: formData.get("title"),
    description: formData.get("description"),
    location: formData.get("location"),
    durationMinutes: formData.get("durationMinutes"),
    timeZone: formData.get("timeZone"),
    weekdays: formData.getAll("weekdays").map(String),
    start: formData.get("start"),
    end: formData.get("end"),
    minNoticeHours: formData.get("minNoticeHours"),
    maxDaysAhead: formData.get("maxDaysAhead"),
  };
}

export async function createBookingPageAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = text(formData, "organizationSlug");
  const context = await requireWorkspace(slug, "booking:manage");
  const correlationId = await getCorrelationId();
  let id: string;
  try {
    ({ id } = await createBookingPage({ prisma: db(), correlationId }, context, {
      ...settingsFrom(formData),
      consentText: formData.get("consentText"),
    }));
  } catch (error) {
    return toActionError(error, correlationId, "booking.create");
  }
  return redirect({ href: `/w/${slug}/booking/${id}`, locale: await getLocale() });
}

export async function updateBookingPageAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "booking:manage");
  const correlationId = await getCorrelationId();
  const consent = formData.get("consentText");
  try {
    await updateBookingPage({ prisma: db(), correlationId }, context, text(formData, "id"), {
      ...settingsFrom(formData),
      ...(consent !== null ? { consentText: consent } : {}),
    });
  } catch (error) {
    return toActionError(error, correlationId, "booking.update");
  }
  refresh();
  return { ok: true };
}

export async function setBookingPageStatusAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "booking:manage");
  const correlationId = await getCorrelationId();
  try {
    await setBookingPageStatus(
      { prisma: db(), correlationId },
      context,
      text(formData, "id"),
      formData.get("status"),
    );
  } catch (error) {
    return toActionError(error, correlationId, "booking.status");
  }
  refresh();
  return { ok: true };
}

export type BookingActionState = ActionState & { booked?: { startsAt: string; endsAt: string } };

/** Anonymous endpoint: no session is read; everything comes from the stored page. */
export async function bookSlotAction(
  _p: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const correlationId = await getCorrelationId();
  // Bots fill every field. A filled honeypot gets the same "success" answer and books nothing.
  if (text(formData, HONEYPOT_FIELD) !== "") return { ok: true };
  if (!(await verifyCaptcha(formData.get(CAPTCHA_FIELD), { remoteIp: await requestIp() }))) {
    return { error: "captcha" };
  }
  try {
    const result = await bookPublicSlot(
      { prisma: db(), correlationId },
      text(formData, "token"),
      {
        startsAt: formData.get("startsAt"),
        name: formData.get("name"),
        email: formData.get("email"),
        note: formData.get("note"),
      },
      formData.get("consent") === "on",
    );
    return {
      ok: true,
      booked: { startsAt: result.startsAt.toISOString(), endsAt: result.endsAt.toISOString() },
    };
  } catch (error) {
    return toActionError(error, correlationId, "booking.book");
  }
}
