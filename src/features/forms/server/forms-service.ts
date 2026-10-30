import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { captureVisitorContact } from "@/features/crm/server/crm-service";
import { publicPagesOpen, requireFeature } from "@/features/billing/server/entitlements";
import {
  buildAnswerSchema,
  assignFieldKeys,
  createFormSchema,
  fieldsInputSchema,
  fieldsSchema,
  formIdSchema,
  MAX_PUBLIC_BODY_CHARS,
  publicTokenSchema,
  statusSchema,
  SUBMISSIONS_PER_DAY,
  templateIn,
  SUBMISSIONS_PER_MINUTE,
  updateFormSchema,
  type FieldDef,
} from "@/features/forms/schemas/forms";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { recordAuditEvent } from "@/server/services/audit";
import { assertActiveMember } from "@/server/services/tenant-refs";

type Deps = { prisma: PrismaClient; correlationId?: string };

const notFound = () => new AppError("NOT_FOUND", "Form not found.");

export type FormView = {
  id: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  createsContact: boolean;
  consentText: string | null;
  fields: FieldDef[];
  publicToken: string;
  submissionCount: number;
};

function parseFields(value: unknown): FieldDef[] {
  const parsed = fieldsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export async function createForm(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(context, "form:manage");
  const parsed = createFormSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Form details are invalid.");
  const copy = templateIn(parsed.data.templateId, parsed.data.locale);
  const template = copy.template;
  const consentText = template.createsContact
    ? (parsed.data.consentText ?? copy.consentText)
    : null;

  return prisma.$transaction(async (tx) => {
    await assertActiveMember(
      tx,
      context.organization.id,
      context.userId,
      "The owner must be an active member.",
    );
    const form = await tx.form.create({
      data: {
        organizationId: context.organization.id,
        title: parsed.data.title,
        description: parsed.data.description,
        fields: copy.fields,
        createsContact: template.createsContact,
        consentText,
        ownerId: context.userId,
        // 128 random bits: unguessable, and unrelated to the form's id.
        publicToken: randomBytes(16).toString("base64url"),
        createdById: context.userId,
      },
      select: { id: true },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "form.created",
      resourceType: "form",
      resourceId: form.id,
      metadata: { template: template.id, locale: parsed.data.locale },
      correlationId,
    });
    return form;
  });
}

export async function listForms(
  { prisma }: Deps,
  context: OrganizationContext,
): Promise<FormView[]> {
  requirePermission(context, "form:manage");
  const rows = await prisma.form.findMany({
    where: { organizationId: context.organization.id },
    include: { _count: { select: { submissions: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createsContact: row.createsContact,
    consentText: row.consentText,
    fields: parseFields(row.fields),
    publicToken: row.publicToken,
    submissionCount: row._count.submissions,
  }));
}

export type SubmissionView = {
  id: string;
  answers: Record<string, unknown>;
  erased: boolean;
  contactId: string | null;
  createdAt: Date;
};

export async function getForm(
  { prisma }: Deps,
  context: OrganizationContext,
  formId: string,
): Promise<{ form: FormView; submissions: SubmissionView[] }> {
  requirePermission(context, "form:manage");
  const id = formIdSchema.safeParse(formId);
  if (!id.success) throw notFound();
  const row = await prisma.form.findFirst({
    where: { id: id.data, organizationId: context.organization.id },
    include: { _count: { select: { submissions: true } } },
  });
  if (!row) throw notFound();
  const submissions = await prisma.formSubmission.findMany({
    where: { organizationId: context.organization.id, formId: row.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return {
    form: {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      createsContact: row.createsContact,
      consentText: row.consentText,
      fields: parseFields(row.fields),
      publicToken: row.publicToken,
      submissionCount: row._count.submissions,
    },
    submissions: submissions.map((submission) => ({
      id: submission.id,
      answers: submission.erasedAt ? {} : (submission.answers as Record<string, unknown>),
      erased: submission.erasedAt !== null,
      contactId: submission.contactId,
      createdAt: submission.createdAt,
    })),
  };
}

export async function updateForm(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  formId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(context, "form:manage");
  const id = formIdSchema.safeParse(formId);
  if (!id.success) throw notFound();
  const parsed = updateFormSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Form details are invalid.");
  await prisma.$transaction(async (tx) => {
    const form = await tx.form.findFirst({
      where: { id: id.data, organizationId: context.organization.id },
      select: { id: true, status: true, createsContact: true },
    });
    if (!form) throw notFound();
    // The consent wording is what visitors agreed to; it cannot change once the form was live.
    if (
      parsed.data.consentText !== undefined &&
      (form.status !== "DRAFT" || !form.createsContact)
    ) {
      throw new AppError(
        "UNPROCESSABLE",
        "The consent wording can only change while the form is a draft.",
      );
    }
    await tx.form.update({ where: { id: form.id }, data: parsed.data });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "form.updated",
      resourceType: "form",
      resourceId: form.id,
      metadata: { fields: Object.keys(parsed.data) },
      correlationId,
    });
  });
}

/** What must stay the same once a form is live: everything about a field except its label. */
const structure = (fields: FieldDef[]) =>
  JSON.stringify(
    fields.map(({ key, type, required, options }) => [key, type, required, options ?? null]),
  );

/**
 * Replaces the fields of a form. While the form is a draft (it cannot have submissions yet) the
 * list can be changed freely; once it has been published only the wording of labels can change,
 * so stored answers keep matching their fields. Forms that create contacts keep a required name
 * and email, because the contact is built from them.
 */
export async function updateFormFields(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  formId: string,
  rawFields: unknown,
): Promise<void> {
  requirePermission(context, "form:manage");
  const id = formIdSchema.safeParse(formId);
  if (!id.success) throw notFound();
  const input = fieldsInputSchema.safeParse(rawFields);
  if (!input.success) throw new AppError("INVALID_INPUT", "The fields are invalid.");
  const keyed = fieldsSchema.safeParse(assignFieldKeys(input.data));
  if (!keyed.success) throw new AppError("INVALID_INPUT", "The fields are invalid.");
  const fields = keyed.data;

  await prisma.$transaction(async (tx) => {
    const form = await tx.form.findFirst({
      where: { id: id.data, organizationId: context.organization.id },
      select: { id: true, status: true, createsContact: true, fields: true },
    });
    if (!form) throw notFound();
    const current = parseFields(form.fields);
    const labelsOnly = form.status !== "DRAFT";
    if (labelsOnly && structure(fields) !== structure(current)) {
      throw new AppError(
        "UNPROCESSABLE",
        "Once a form has been published only the labels can change.",
      );
    }
    if (form.createsContact) {
      const name = fields.find((field) => field.key === "name");
      const email = fields.find((field) => field.key === "email");
      if (name?.type !== "text" || !name.required || email?.type !== "email" || !email.required) {
        throw new AppError(
          "UNPROCESSABLE",
          "A form that creates contacts needs a required name and email.",
        );
      }
    }
    await tx.form.update({ where: { id: form.id }, data: { fields } });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "form.fields_updated",
      resourceType: "form",
      resourceId: form.id,
      // Counts only: labels are the owner's wording, not something the trail needs to hold.
      metadata: { fields: fields.length, labelsOnly },
      correlationId,
    });
  });
}

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["CLOSED"],
  CLOSED: ["PUBLISHED"],
};

export async function setFormStatus(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  formId: string,
  rawStatus: unknown,
): Promise<void> {
  requirePermission(context, "form:manage");
  const id = formIdSchema.safeParse(formId);
  const status = statusSchema.safeParse(rawStatus);
  if (!id.success) throw notFound();
  if (!status.success) throw new AppError("INVALID_INPUT", "Choose a status.");
  await prisma.$transaction(async (tx) => {
    const form = await tx.form.findFirst({
      where: { id: id.data, organizationId: context.organization.id },
    });
    if (!form) throw notFound();
    if (form.status === status.data) return;
    if (!TRANSITIONS[form.status]?.includes(status.data)) {
      throw new AppError("UNPROCESSABLE", "This status change is not allowed.");
    }
    if (status.data === "PUBLISHED") {
      await requireFeature(tx, context.organization.id, "publicPages");
      const keys = parseFields(form.fields).map((field) => field.key);
      if (
        form.createsContact &&
        !(keys.includes("name") && keys.includes("email") && form.consentText)
      ) {
        throw new AppError(
          "UNPROCESSABLE",
          "A form that creates contacts needs name, email and consent wording.",
        );
      }
      // The owner receives the contacts; they must still be an active member.
      await assertActiveMember(
        tx,
        context.organization.id,
        form.ownerId,
        "The form owner must be an active member.",
      );
    }
    await tx.form.update({ where: { id: form.id }, data: { status: status.data } });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "form.status_changed",
      resourceType: "form",
      resourceId: form.id,
      metadata: { from: form.status, to: status.data },
      correlationId,
    });
  });
}

export type PublicForm = {
  title: string;
  description: string | null;
  organizationName: string;
  fields: FieldDef[];
  consentText: string | null;
};

/** What an anonymous visitor may see. Unknown, draft and closed forms are indistinguishable. */
export async function getPublicForm(
  { prisma }: Pick<Deps, "prisma">,
  rawToken: string,
): Promise<PublicForm> {
  const token = publicTokenSchema.safeParse(rawToken);
  if (!token.success) throw notFound();
  const form = await prisma.form.findUnique({
    where: { publicToken: token.data },
    include: { organization: { select: { id: true, name: true, suspendedAt: true } } },
  });
  if (!form || form.status !== "PUBLISHED") throw notFound();
  if (!(await publicPagesOpen(prisma, form.organization))) throw notFound();
  return {
    title: form.title,
    description: form.description,
    organizationName: form.organization.name,
    fields: parseFields(form.fields),
    consentText: form.createsContact ? form.consentText : null,
  };
}

/**
 * Accepts an anonymous submission. The form is found by its public token only; the organization,
 * owner and field rules all come from the stored form, never from the request. Answers are
 * validated strictly, volume is capped, and a visitor's consent is required (and recorded) when
 * the form creates contacts.
 */
export async function submitPublicForm(
  { prisma, correlationId }: Deps,
  rawToken: string,
  rawAnswers: unknown,
  consentAccepted: boolean,
  now: Date = new Date(),
): Promise<void> {
  const token = publicTokenSchema.safeParse(rawToken);
  if (!token.success) throw notFound();
  if (JSON.stringify(rawAnswers ?? null).length > MAX_PUBLIC_BODY_CHARS) {
    throw new AppError("INVALID_INPUT", "The submission is too large.");
  }
  const form = await prisma.form.findUnique({
    where: { publicToken: token.data },
    include: { organization: { select: { id: true, suspendedAt: true } } },
  });
  if (!form || form.status !== "PUBLISHED") throw notFound();
  if (!(await publicPagesOpen(prisma, form.organization, now))) throw notFound();
  const organizationId = form.organizationId;

  const answers = buildAnswerSchema(parseFields(form.fields)).safeParse(rawAnswers);
  if (!answers.success)
    throw new AppError("INVALID_INPUT", "Please check the highlighted answers.");
  if (form.createsContact && !consentAccepted) {
    throw new AppError("INVALID_INPUT", "You need to accept the consent statement.");
  }

  const [lastMinute, lastDay] = await Promise.all([
    prisma.formSubmission.count({
      where: {
        organizationId,
        formId: form.id,
        createdAt: { gt: new Date(now.getTime() - 60_000) },
      },
    }),
    prisma.formSubmission.count({
      where: {
        organizationId,
        formId: form.id,
        createdAt: { gt: new Date(now.getTime() - 86_400_000) },
      },
    }),
  ]);
  if (lastMinute >= SUBMISSIONS_PER_MINUTE || lastDay >= SUBMISSIONS_PER_DAY) {
    throw new AppError("RATE_LIMITED", "Too many submissions.");
  }

  const data = answers.data as Record<string, string>;
  await prisma.$transaction(async (tx) => {
    let contactId: string | null = null;
    let contactCreated = false;
    if (form.createsContact) {
      const owner = await tx.member.findFirst({
        where: { organizationId, userId: form.ownerId, status: "ACTIVE" },
        select: { id: true },
      });
      // Without an active owner the submission is still kept, just not turned into a contact.
      if (owner) {
        const captured = await captureVisitorContact(tx, {
          organizationId,
          ownerId: form.ownerId,
          name: data.name!,
          email: data.email!,
          phone: data.phone,
          company: data.company,
          source: `form: ${form.title}`,
          now,
        });
        contactId = captured.contactId;
        contactCreated = captured.created;
      }
    }
    const submission = await tx.formSubmission.create({
      data: {
        organizationId,
        formId: form.id,
        answers: data as Prisma.InputJsonObject,
        contactId,
        createdAt: now,
      },
      select: { id: true },
    });
    // No actor (an anonymous visitor) and no answers: the audit trail holds the fact only.
    await recordAuditEvent(tx, {
      organizationId,
      actorId: null,
      action: "form.submitted",
      resourceType: "form",
      resourceId: form.id,
      metadata: { submissionId: submission.id, contactCreated },
      correlationId,
    });
  });
}
