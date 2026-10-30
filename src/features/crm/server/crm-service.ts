import "server-only";
import { Prisma, type JourneyStage, type PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  activitySchema,
  consentSchema,
  createContactSchema,
  createDealSchema,
  idSchema,
  journeyStageSchema,
  searchSchema,
  stageSchema,
  updateContactSchema,
} from "@/features/crm/schemas/crm";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { recordAuditEvent } from "@/server/services/audit";
import { assertActiveMember } from "@/server/services/tenant-refs";

type Deps = { prisma: PrismaClient; correlationId?: string };
type Tx = Prisma.TransactionClient;

const contactNotFound = () => new AppError("NOT_FOUND", "Contact not found.");
const dealNotFound = () => new AppError("NOT_FOUND", "Deal not found.");

const canReadAll = (context: OrganizationContext) => context.permissions.includes("crm:read-all");

/**
 * Contacts the caller may see: everything in the organization for managers and above, otherwise
 * only contacts they own. Members of the organization without any CRM permission see nothing
 * because every entry point checks `crm:read` first.
 */
export function contactAccessWhere(context: OrganizationContext): Prisma.CrmContactWhereInput {
  return {
    organizationId: context.organization.id,
    ...(canReadAll(context) ? {} : { ownerId: context.userId }),
  };
}

/** A deal is visible through its contact, or because the caller owns the deal. */
export function dealAccessWhere(context: OrganizationContext): Prisma.CrmDealWhereInput {
  return {
    organizationId: context.organization.id,
    ...(canReadAll(context)
      ? {}
      : { OR: [{ ownerId: context.userId }, { contact: { ownerId: context.userId } }] }),
  };
}

export type ContactView = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  ownerId: string;
  consentStatus: "UNKNOWN" | "GRANTED" | "WITHDRAWN";
  consentUpdatedAt: Date | null;
  journeyStage: JourneyStage;
  erased: boolean;
  mine: boolean;
};

const contactSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  company: true,
  ownerId: true,
  consentStatus: true,
  consentUpdatedAt: true,
  journeyStage: true,
  erasedAt: true,
} satisfies Prisma.CrmContactSelect;

const toContact = (
  row: Prisma.CrmContactGetPayload<{ select: typeof contactSelect }>,
  context: OrganizationContext,
): ContactView => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  company: row.company,
  ownerId: row.ownerId,
  consentStatus: row.consentStatus,
  consentUpdatedAt: row.consentUpdatedAt,
  journeyStage: row.journeyStage,
  erased: row.erasedAt !== null,
  mine: row.ownerId === context.userId,
});

async function accessibleContact(
  client: Pick<Tx, "crmContact">,
  context: OrganizationContext,
  id: string,
) {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw contactNotFound();
  const row = await client.crmContact.findFirst({
    where: { ...contactAccessWhere(context), id: parsed.data },
    select: contactSelect,
  });
  if (!row) throw contactNotFound();
  return row;
}

/** Writes one entry of the append-only journey history. Callers update the contact themselves. */
export async function recordStageChange(
  tx: Pick<Tx, "contactStageChange">,
  change: {
    organizationId: string;
    contactId: string;
    from: JourneyStage | null;
    to: JourneyStage;
    reason: "CREATED" | "MANUAL" | "DEAL_WON";
    changedById: string;
  },
) {
  await tx.contactStageChange.create({
    data: {
      organizationId: change.organizationId,
      contactId: change.contactId,
      fromStage: change.from,
      toStage: change.to,
      reason: change.reason,
      changedById: change.changedById,
    },
  });
}

/** Moves a contact to another stage of the journey and keeps the history. */
export async function setJourneyStage(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  contactId: string,
  rawStage: unknown,
): Promise<void> {
  requirePermission(context, "crm:write");
  const stage = journeyStageSchema.safeParse(rawStage);
  if (!stage.success) throw new AppError("INVALID_INPUT", "Choose a journey stage.");
  await prisma.$transaction(async (tx) => {
    const contact = await accessibleContact(tx, context, contactId);
    if (contact.erasedAt) {
      throw new AppError("UNPROCESSABLE", "An erased contact has no journey.");
    }
    if (contact.journeyStage === stage.data) return;
    await tx.crmContact.update({ where: { id: contact.id }, data: { journeyStage: stage.data } });
    await recordStageChange(tx, {
      organizationId: context.organization.id,
      contactId: contact.id,
      from: contact.journeyStage,
      to: stage.data,
      reason: "MANUAL",
      changedById: context.userId,
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "crm.journey_stage_changed",
      resourceType: "crm_contact",
      resourceId: contact.id,
      metadata: { from: contact.journeyStage, to: stage.data },
      correlationId,
    });
  });
}

export async function listContacts(
  { prisma }: Deps,
  context: OrganizationContext,
  rawQuery: unknown = "",
  options: { stage?: unknown } = {},
): Promise<ContactView[]> {
  requirePermission(context, "crm:read");
  const stage = journeyStageSchema.safeParse(options.stage);
  const parsedQuery = searchSchema.safeParse(rawQuery ?? "");
  if (!parsedQuery.success) throw new AppError("INVALID_INPUT", "Search text is too long.");
  // `contains` is a LIKE pattern: escape its wildcards so the text is matched literally.
  const q = { data: parsedQuery.data.replace(/[\\%_]/g, "\\$&") };
  const rows = await prisma.crmContact.findMany({
    where: {
      ...contactAccessWhere(context),
      ...(stage.success ? { journeyStage: stage.data } : {}),
      ...(q.data
        ? {
            OR: [
              { name: { contains: q.data, mode: "insensitive" } },
              { email: { contains: q.data.toLowerCase() } },
              { company: { contains: q.data, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: contactSelect,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 200,
  });
  return rows.map((row) => toContact(row, context));
}

export async function createContact(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
): Promise<ContactView> {
  requirePermission(context, "crm:write");
  const parsed = createContactSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Contact details are invalid.");
  const input = parsed.data;
  if (input.consentStatus && !input.consentSource) {
    throw new AppError("INVALID_INPUT", "Say how consent was given.");
  }
  const organizationId = context.organization.id;
  const ownerId = input.ownerId ?? context.userId;
  if (ownerId !== context.userId && !canReadAll(context)) {
    throw new AppError("FORBIDDEN", "You can only create contacts for yourself.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await assertActiveMember(tx, organizationId, ownerId, "The owner must be an active member.");
      const now = new Date();
      const row = await tx.crmContact.create({
        data: {
          organizationId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          company: input.company,
          ownerId,
          createdById: context.userId,
          consentStatus: input.consentStatus ?? "UNKNOWN",
          consentUpdatedAt: input.consentStatus ? now : null,
        },
        select: contactSelect,
      });
      await recordStageChange(tx, {
        organizationId,
        contactId: row.id,
        from: null,
        to: row.journeyStage,
        reason: "CREATED",
        changedById: context.userId,
      });
      if (input.consentStatus) {
        await tx.consentEvent.create({
          data: {
            organizationId,
            contactId: row.id,
            status: input.consentStatus,
            source: input.consentSource!,
            recordedById: context.userId,
          },
        });
      }
      // Identifiers only: names, emails and phone numbers never enter the audit trail.
      await recordAuditEvent(tx, {
        organizationId,
        actorId: context.userId,
        action: "crm.contact_created",
        resourceType: "crm_contact",
        resourceId: row.id,
        correlationId,
      });
      return toContact(row, context);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "A contact with this email already exists.");
    }
    throw error;
  }
}

export async function updateContact(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  contactId: string,
  rawInput: unknown,
): Promise<ContactView> {
  requirePermission(context, "crm:write");
  const parsed = updateContactSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Contact details are invalid.");
  const input = parsed.data;
  if (input.ownerId !== undefined && !canReadAll(context)) {
    throw new AppError("FORBIDDEN", "Only managers can reassign contacts.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await accessibleContact(tx, context, contactId);
      if (existing.erasedAt)
        throw new AppError("UNPROCESSABLE", "Erased contacts cannot be edited.");
      if (input.ownerId) {
        await assertActiveMember(
          tx,
          context.organization.id,
          input.ownerId,
          "The owner must be an active member.",
        );
      }
      const row = await tx.crmContact.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          company: input.company,
          ownerId: input.ownerId,
        },
        select: contactSelect,
      });
      await recordAuditEvent(tx, {
        organizationId: context.organization.id,
        actorId: context.userId,
        action: "crm.contact_updated",
        resourceType: "crm_contact",
        resourceId: row.id,
        metadata: {
          fields: Object.keys(input).filter(
            (key) => input[key as keyof typeof input] !== undefined,
          ),
        },
        correlationId,
      });
      return toContact(row, context);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "A contact with this email already exists.");
    }
    throw error;
  }
}

/** Records a consent decision with its basis; the history is append-only. */
export async function recordConsent(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  contactId: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(context, "crm:write");
  const parsed = consentSchema.safeParse(rawInput);
  if (!parsed.success)
    throw new AppError("INVALID_INPUT", "Choose a status and say how it was given.");
  await prisma.$transaction(async (tx) => {
    const contact = await accessibleContact(tx, context, contactId);
    if (contact.erasedAt) throw new AppError("UNPROCESSABLE", "Erased contacts cannot be edited.");
    await tx.crmContact.update({
      where: { id: contact.id },
      data: { consentStatus: parsed.data.status, consentUpdatedAt: now },
    });
    await tx.consentEvent.create({
      data: {
        organizationId: context.organization.id,
        contactId: contact.id,
        status: parsed.data.status,
        source: parsed.data.source,
        recordedById: context.userId,
        createdAt: now,
      },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "crm.consent_recorded",
      resourceType: "crm_contact",
      resourceId: contact.id,
      metadata: { status: parsed.data.status },
      correlationId,
    });
  });
}

/**
 * Right to erasure: removes the personal data of a contact (name, email, phone, company, the
 * text of their activities) but keeps the row, its deals and the consent history, so reports and
 * proof of consent stay intact.
 */
export async function eraseContact(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  contactId: string,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(context, "crm:erase");
  await prisma.$transaction(async (tx) => {
    const contact = await accessibleContact(tx, context, contactId);
    if (contact.erasedAt) return;
    await tx.crmContact.update({
      where: { id: contact.id },
      data: { name: "Erased contact", email: null, phone: null, company: null, erasedAt: now },
    });
    await tx.crmActivity.updateMany({
      where: { organizationId: context.organization.id, contactId: contact.id },
      data: { body: "" },
    });
    // Answers this person gave on public forms are personal data too.
    await tx.formSubmission.updateMany({
      where: { organizationId: context.organization.id, contactId: contact.id },
      data: { answers: {}, erasedAt: now },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "crm.contact_erased",
      resourceType: "crm_contact",
      resourceId: contact.id,
      correlationId,
    });
  });
}

export type DealView = {
  id: string;
  contactId: string;
  contactName: string;
  title: string;
  stage: (typeof import("@/features/crm/schemas/crm").DEAL_STAGES)[number];
  amountMinor: number | null;
  currency: string;
  ownerId: string;
  expectedCloseAt: Date | null;
  closedAt: Date | null;
};

const dealInclude = { contact: { select: { name: true } } } as const;
const toDeal = (row: Prisma.CrmDealGetPayload<{ include: typeof dealInclude }>): DealView => ({
  id: row.id,
  contactId: row.contactId,
  contactName: row.contact.name,
  title: row.title,
  stage: row.stage,
  amountMinor: row.amountMinor,
  currency: row.currency,
  ownerId: row.ownerId,
  expectedCloseAt: row.expectedCloseAt,
  closedAt: row.closedAt,
});

export async function listDeals(
  { prisma }: Deps,
  context: OrganizationContext,
  filter: { contactId?: string } = {},
): Promise<DealView[]> {
  requirePermission(context, "crm:read");
  const rows = await prisma.crmDeal.findMany({
    where: {
      ...dealAccessWhere(context),
      ...(filter.contactId ? { contactId: filter.contactId } : {}),
    },
    include: dealInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  return rows.map(toDeal);
}

export async function createDeal(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
): Promise<DealView> {
  requirePermission(context, "crm:write");
  const parsed = createDealSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Deal details are invalid.");
  const input = parsed.data;
  const ownerId = input.ownerId ?? context.userId;
  if (ownerId !== context.userId && !canReadAll(context)) {
    throw new AppError("FORBIDDEN", "You can only create deals for yourself.");
  }
  return prisma.$transaction(async (tx) => {
    const contact = await accessibleContact(tx, context, input.contactId);
    if (contact.erasedAt)
      throw new AppError("UNPROCESSABLE", "Erased contacts cannot get new deals.");
    await assertActiveMember(
      tx,
      context.organization.id,
      ownerId,
      "The owner must be an active member.",
    );
    const row = await tx.crmDeal.create({
      data: {
        organizationId: context.organization.id,
        contactId: contact.id,
        title: input.title,
        amountMinor: input.amount === undefined ? undefined : Math.round(input.amount * 100),
        currency: input.currency,
        ownerId,
        expectedCloseAt: input.expectedCloseAt,
        createdById: context.userId,
      },
      include: dealInclude,
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "crm.deal_created",
      resourceType: "crm_deal",
      resourceId: row.id,
      correlationId,
    });
    return toDeal(row);
  });
}

export async function moveDeal(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  dealId: string,
  rawStage: unknown,
  now: Date = new Date(),
): Promise<DealView> {
  requirePermission(context, "crm:write");
  const id = idSchema.safeParse(dealId);
  const stage = stageSchema.safeParse(rawStage);
  if (!id.success) throw dealNotFound();
  if (!stage.success) throw new AppError("INVALID_INPUT", "Choose a stage.");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.crmDeal.findFirst({
      where: { ...dealAccessWhere(context), id: id.data },
      include: dealInclude,
    });
    if (!existing) throw dealNotFound();
    if (existing.stage === stage.data) return toDeal(existing);
    const closed = stage.data === "WON" || stage.data === "LOST";
    const row = await tx.crmDeal.update({
      where: { id: existing.id },
      data: { stage: stage.data, closedAt: closed ? now : null },
      include: dealInclude,
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "crm.deal_stage_changed",
      resourceType: "crm_deal",
      resourceId: row.id,
      metadata: { from: existing.stage, to: stage.data },
      correlationId,
    });
    // Winning a deal makes the contact a customer, whatever stage they were in.
    if (stage.data === "WON") {
      const contact = await tx.crmContact.findFirst({
        where: { id: existing.contactId, organizationId: context.organization.id },
        select: { journeyStage: true, erasedAt: true },
      });
      if (contact && !contact.erasedAt && contact.journeyStage !== "CUSTOMER") {
        await tx.crmContact.update({
          where: { id: existing.contactId },
          data: { journeyStage: "CUSTOMER" },
        });
        await recordStageChange(tx, {
          organizationId: context.organization.id,
          contactId: existing.contactId,
          from: contact.journeyStage,
          to: "CUSTOMER",
          reason: "DEAL_WON",
          changedById: context.userId,
        });
      }
    }
    return toDeal(row);
  });
}

export type ActivityView = {
  id: string;
  type: "NOTE" | "CALL" | "EMAIL" | "MEETING";
  body: string;
  dealId: string | null;
  occurredAt: Date;
  authorName: string | null;
};

export async function addActivity(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(context, "crm:write");
  const parsed = activitySchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Activity details are invalid.");
  const input = parsed.data;
  await prisma.$transaction(async (tx) => {
    const contact = await accessibleContact(tx, context, input.contactId);
    if (contact.erasedAt) throw new AppError("UNPROCESSABLE", "Erased contacts cannot be edited.");
    if (input.dealId) {
      const deal = await tx.crmDeal.findFirst({
        where: { ...dealAccessWhere(context), id: input.dealId, contactId: contact.id },
        select: { id: true },
      });
      if (!deal) throw new AppError("UNPROCESSABLE", "The deal does not belong to this contact.");
    }
    const row = await tx.crmActivity.create({
      data: {
        organizationId: context.organization.id,
        contactId: contact.id,
        dealId: input.dealId,
        type: input.type,
        body: input.body,
        authorId: context.userId,
        occurredAt: input.occurredAt ?? now,
      },
      select: { id: true },
    });
    // The note text is personal data about a third party: only the fact is audited.
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "crm.activity_added",
      resourceType: "crm_contact",
      resourceId: contact.id,
      metadata: { activityId: row.id, type: input.type },
      correlationId,
    });
  });
}

export type ContactDetail = {
  contact: ContactView;
  deals: DealView[];
  activities: ActivityView[];
  consentHistory: { status: "UNKNOWN" | "GRANTED" | "WITHDRAWN"; source: string; at: Date }[];
  /** Newest first. Written when the contact is created and on every later change. */
  journeyHistory: {
    from: JourneyStage | null;
    to: JourneyStage;
    reason: "CREATED" | "MANUAL" | "DEAL_WON";
    at: Date;
  }[];
};

export async function getContactDetail(
  { prisma }: Deps,
  context: OrganizationContext,
  contactId: string,
): Promise<ContactDetail> {
  requirePermission(context, "crm:read");
  const contact = await accessibleContact(prisma, context, contactId);
  const organizationId = context.organization.id;
  const [deals, activities, consents, journey] = await Promise.all([
    prisma.crmDeal.findMany({
      where: { organizationId, contactId: contact.id },
      include: dealInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.crmActivity.findMany({
      where: { organizationId, contactId: contact.id },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 200,
    }),
    prisma.consentEvent.findMany({
      where: { organizationId, contactId: contact.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
    prisma.contactStageChange.findMany({
      where: { organizationId, contactId: contact.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
  ]);
  const authors = await prisma.user.findMany({
    where: {
      id: { in: [...new Set(activities.map((activity) => activity.authorId))] },
      memberships: { some: { organizationId } },
    },
    select: { id: true, name: true },
  });
  const names = new Map(authors.map((author) => [author.id, author.name]));
  return {
    contact: toContact(contact, context),
    deals: deals.map(toDeal),
    activities: activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      body: activity.body,
      dealId: activity.dealId,
      occurredAt: activity.occurredAt,
      authorName: names.get(activity.authorId) ?? null,
    })),
    consentHistory: consents.map((event) => ({
      status: event.status,
      source: event.source,
      at: event.createdAt,
    })),
    journeyHistory: journey.map((change) => ({
      from: change.fromStage,
      to: change.toStage,
      reason: change.reason,
      at: change.createdAt,
    })),
  };
}

export type PipelineReport = {
  /** Open deals per stage, with value summed per currency (never across currencies). */
  stages: { stage: DealView["stage"]; count: number; value: Record<string, number> }[];
  won: { count: number; value: Record<string, number> };
  lost: { count: number };
  /** Won / (won + lost) among deals closed in the period; null when none closed. */
  winRatePercent: number | null;
  periodDays: number;
};

export async function pipelineReport(
  { prisma }: Deps,
  context: OrganizationContext,
  periodDays = 90,
  now: Date = new Date(),
): Promise<PipelineReport> {
  requirePermission(context, "crm:read");
  const days = Math.min(Math.max(Math.trunc(periodDays), 1), 3650);
  const since = new Date(now.getTime() - days * 86_400_000);
  const where = dealAccessWhere(context);

  const [open, closed] = await Promise.all([
    prisma.crmDeal.groupBy({
      by: ["stage", "currency"],
      where: { ...where, stage: { notIn: ["WON", "LOST"] } },
      _count: { _all: true },
      _sum: { amountMinor: true },
    }),
    prisma.crmDeal.groupBy({
      by: ["stage", "currency"],
      where: { ...where, stage: { in: ["WON", "LOST"] }, closedAt: { gte: since } },
      _count: { _all: true },
      _sum: { amountMinor: true },
    }),
  ]);

  const order = ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION"] as const;
  const stages = order.map((stage) => {
    const rows = open.filter((row) => row.stage === stage);
    return {
      stage,
      count: rows.reduce((sum, row) => sum + row._count._all, 0),
      value: Object.fromEntries(rows.map((row) => [row.currency, row._sum.amountMinor ?? 0])),
    };
  });
  const wonRows = closed.filter((row) => row.stage === "WON");
  const wonCount = wonRows.reduce((sum, row) => sum + row._count._all, 0);
  const lostCount = closed
    .filter((row) => row.stage === "LOST")
    .reduce((sum, row) => sum + row._count._all, 0);
  return {
    stages,
    won: {
      count: wonCount,
      value: Object.fromEntries(wonRows.map((row) => [row.currency, row._sum.amountMinor ?? 0])),
    },
    lost: { count: lostCount },
    winRatePercent:
      wonCount + lostCount === 0 ? null : Math.round((wonCount / (wonCount + lostCount)) * 100),
    periodDays: days,
  };
}
