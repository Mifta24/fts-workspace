"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { HONEYPOT_FIELD } from "@/features/forms/schemas/forms";
import {
  createForm,
  setFormStatus,
  submitPublicForm,
  updateForm,
  updateFormFields,
} from "@/features/forms/server/forms-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { CAPTCHA_FIELD, verifyCaptcha } from "@/server/security/captcha";
import { requestIp } from "@/server/security/request-ip";
import { toActionError, type ActionState } from "@/server/services/action-result";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const refresh = () => revalidatePath("/[locale]/w/[organizationSlug]/forms", "layout");

export async function createFormAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  const slug = text(formData, "organizationSlug");
  const context = await requireWorkspace(slug, "form:manage");
  const correlationId = await getCorrelationId();
  let id: string;
  try {
    ({ id } = await createForm({ prisma: db(), correlationId }, context, {
      templateId: formData.get("templateId"),
      // The copied labels follow the language the owner is using right now.
      locale: await getLocale(),
      title: formData.get("title"),
      description: formData.get("description"),
      consentText: formData.get("consentText"),
    }));
  } catch (error) {
    return toActionError(error, correlationId, "form.create");
  }
  return redirect({ href: `/w/${slug}/forms/${id}`, locale: await getLocale() });
}

export async function updateFormAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "form:manage");
  const correlationId = await getCorrelationId();
  const input: Record<string, FormDataEntryValue> = {};
  for (const key of ["title", "description", "consentText"]) {
    const value = formData.get(key);
    if (value !== null) input[key] = value;
  }
  try {
    await updateForm({ prisma: db(), correlationId }, context, text(formData, "id"), input);
  } catch (error) {
    return toActionError(error, correlationId, "form.update");
  }
  refresh();
  return { ok: true };
}

const MAX_FIELDS_JSON = 30_000;

export async function updateFormFieldsAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "form:manage");
  const correlationId = await getCorrelationId();
  const raw = text(formData, "fields");
  let fields: unknown = null;
  if (raw.length <= MAX_FIELDS_JSON) {
    try {
      fields = JSON.parse(raw);
    } catch {
      fields = null;
    }
  }
  try {
    await updateFormFields({ prisma: db(), correlationId }, context, text(formData, "id"), fields);
  } catch (error) {
    return toActionError(error, correlationId, "form.fields");
  }
  refresh();
  return { ok: true };
}

export async function setFormStatusAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "form:manage");
  const correlationId = await getCorrelationId();
  try {
    await setFormStatus(
      { prisma: db(), correlationId },
      context,
      text(formData, "id"),
      formData.get("status"),
    );
  } catch (error) {
    return toActionError(error, correlationId, "form.status");
  }
  refresh();
  return { ok: true };
}

/** Anonymous endpoint: no session is read or needed; everything comes from the stored form. */
export async function submitFormAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  const correlationId = await getCorrelationId();
  // Bots fill every field. A filled honeypot gets the same "success" answer and saves nothing.
  if (text(formData, HONEYPOT_FIELD) !== "") return { ok: true };
  // With Turnstile configured, a valid single-use token is required before anything is read.
  if (!(await verifyCaptcha(formData.get(CAPTCHA_FIELD), { remoteIp: await requestIp() }))) {
    return { error: "captcha" };
  }

  const answers: Record<string, FormDataEntryValue> = {};
  for (const [key, value] of formData.entries()) {
    if (
      key === "token" ||
      key === "consent" ||
      key === HONEYPOT_FIELD ||
      key === CAPTCHA_FIELD ||
      key.startsWith("$ACTION")
    )
      continue;
    if (typeof value === "string") answers[key] = value;
  }
  try {
    await submitPublicForm(
      { prisma: db(), correlationId },
      text(formData, "token"),
      answers,
      formData.get("consent") === "on",
    );
  } catch (error) {
    return toActionError(error, correlationId, "form.submit");
  }
  return { ok: true };
}
