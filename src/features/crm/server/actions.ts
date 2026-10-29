"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import {
  addActivity,
  createContact,
  createDeal,
  eraseContact,
  moveDeal,
  recordConsent,
  updateContact,
} from "@/features/crm/server/crm-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { toActionError, type ActionState } from "@/server/services/action-result";

const CRM = "/[locale]/w/[organizationSlug]/crm";
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

function refresh() {
  revalidatePath(CRM, "layout");
}

export async function createContactAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = text(formData, "organizationSlug");
  const context = await requireWorkspace(slug, "crm:write");
  const correlationId = await getCorrelationId();
  let id: string;
  try {
    ({ id } = await createContact({ prisma: db(), correlationId }, context, {
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      company: formData.get("company"),
      consentStatus: formData.get("consentStatus"),
      consentSource: formData.get("consentSource"),
    }));
  } catch (error) {
    return toActionError(error, correlationId, "crm.contact.create");
  }
  return redirect({ href: `/w/${slug}/crm/${id}`, locale: await getLocale() });
}

export async function updateContactAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "crm:write");
  const correlationId = await getCorrelationId();
  try {
    await updateContact({ prisma: db(), correlationId }, context, text(formData, "id"), {
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      company: formData.get("company"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "crm.contact.update");
  }
  refresh();
  return { ok: true };
}

export async function recordConsentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "crm:write");
  const correlationId = await getCorrelationId();
  try {
    await recordConsent({ prisma: db(), correlationId }, context, text(formData, "id"), {
      status: formData.get("status"),
      source: formData.get("source"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "crm.consent");
  }
  refresh();
  return { ok: true };
}

export async function eraseContactAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "crm:erase");
  const correlationId = await getCorrelationId();
  try {
    await eraseContact({ prisma: db(), correlationId }, context, text(formData, "id"));
  } catch (error) {
    return toActionError(error, correlationId, "crm.erase");
  }
  refresh();
  return { ok: true };
}

export async function createDealAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "crm:write");
  const correlationId = await getCorrelationId();
  try {
    await createDeal({ prisma: db(), correlationId }, context, {
      contactId: formData.get("contactId"),
      title: formData.get("title"),
      amount: formData.get("amount"),
      currency: formData.get("currency"),
      expectedCloseAt: formData.get("expectedCloseAt"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "crm.deal.create");
  }
  refresh();
  return { ok: true };
}

export async function moveDealAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "crm:write");
  const correlationId = await getCorrelationId();
  try {
    await moveDeal(
      { prisma: db(), correlationId },
      context,
      text(formData, "id"),
      formData.get("stage"),
    );
  } catch (error) {
    return toActionError(error, correlationId, "crm.deal.move");
  }
  refresh();
  return { ok: true };
}

export async function addActivityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "crm:write");
  const correlationId = await getCorrelationId();
  try {
    await addActivity({ prisma: db(), correlationId }, context, {
      contactId: formData.get("contactId"),
      dealId: formData.get("dealId"),
      type: formData.get("type"),
      body: formData.get("body"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "crm.activity.add");
  }
  refresh();
  return { ok: true };
}
