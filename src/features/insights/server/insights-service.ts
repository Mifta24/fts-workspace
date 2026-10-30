import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { contactAccessWhere } from "@/features/crm/server/crm-service";
import { periodSchema } from "@/features/insights/schemas/insights";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";

type Deps = { prisma: PrismaClient };

const DAY = 86_400_000;
const MAX_FORMS = 100;

type Consent = "UNKNOWN" | "GRANTED" | "WITHDRAWN";
type JourneyStage = "LEAD" | "PROSPECT" | "CUSTOMER" | "LAPSED";
type Response = "PENDING" | "ACCEPTED" | "DECLINED";

export type Insights = {
  periodDays: number;
  from: Date;
  to: Date;
  /** CRM contacts the caller may see (all of them for managers and above). Null without CRM access. */
  contacts: {
    created: number;
    createdPreviousPeriod: number;
    /** New contacts in the period that came in through a public form. */
    createdFromForms: number;
    erased: number;
    /** Consent state of the contacts that still hold personal data. */
    consent: Record<Consent, number>;
    /** Journey stage today of the contacts that still hold personal data. */
    journey: Record<JourneyStage, number>;
    /** Contacts that reached the customer stage during the period. */
    becameCustomers: number;
  } | null;
  /** Organization-wide form figures. Null unless the caller manages forms. */
  forms: {
    submissions: number;
    submissionsPreviousPeriod: number;
    submissionsWithContact: number;
    perForm: {
      formId: string;
      title: string;
      status: "DRAFT" | "PUBLISHED" | "CLOSED";
      submissions: number;
      withContact: number;
    }[];
  } | null;
  /** Only the caller's own meetings: other people's calendars are not reported on. */
  meetings: {
    upcoming: number;
    held: number;
    organized: number;
    cancelled: number;
    /** Answers of the guests of the meetings the caller organized in the period. */
    guestResponses: Record<Response, number>;
  };
};

const zeroResponses = (): Record<Response, number> => ({ PENDING: 0, ACCEPTED: 0, DECLINED: 0 });

/**
 * Counts only: nothing here returns names, emails, answers or titles of people's data, and every
 * query is scoped to the caller's organization and to what the caller may see elsewhere.
 * Periods are `[from, to)` ending at `now`, so the previous period never overlaps it.
 */
export async function getInsights(
  { prisma }: Deps,
  context: OrganizationContext,
  rawPeriodDays: unknown,
  now: Date = new Date(),
): Promise<Insights> {
  requirePermission(context, "dashboard:read");
  const periodDays = periodSchema.parse(rawPeriodDays);
  const to = now;
  const from = new Date(to.getTime() - periodDays * DAY);
  const previousFrom = new Date(from.getTime() - periodDays * DAY);
  const organizationId = context.organization.id;
  const inPeriod = { gte: from, lt: to };
  const inPrevious = { gte: previousFrom, lt: from };

  const [contacts, forms, meetings] = await Promise.all([
    context.permissions.includes("crm:read") ? contactFigures() : null,
    context.permissions.includes("form:manage") ? formFigures() : null,
    meetingFigures(),
  ]);
  return { periodDays, from, to, contacts, forms, meetings };

  async function contactFigures(): Promise<Insights["contacts"]> {
    const scope = contactAccessWhere(context);
    const [created, createdPreviousPeriod, createdFromForms, erased, consent, journey, customers] =
      await Promise.all([
        prisma.crmContact.count({ where: { ...scope, createdAt: inPeriod } }),
        prisma.crmContact.count({ where: { ...scope, createdAt: inPrevious } }),
        prisma.crmContact.count({
          where: { ...scope, createdAt: inPeriod, formSubmissions: { some: { organizationId } } },
        }),
        prisma.crmContact.count({ where: { ...scope, erasedAt: inPeriod } }),
        prisma.crmContact.groupBy({
          by: ["consentStatus"],
          where: { ...scope, erasedAt: null },
          _count: { _all: true },
        }),
        prisma.crmContact.groupBy({
          by: ["journeyStage"],
          where: { ...scope, erasedAt: null },
          _count: { _all: true },
        }),
        prisma.contactStageChange.groupBy({
          by: ["contactId"],
          where: { organizationId, toStage: "CUSTOMER", createdAt: inPeriod, contact: scope },
        }),
      ]);
    const byStatus: Record<Consent, number> = { UNKNOWN: 0, GRANTED: 0, WITHDRAWN: 0 };
    for (const row of consent) byStatus[row.consentStatus] = row._count._all;
    const byStage: Record<JourneyStage, number> = { LEAD: 0, PROSPECT: 0, CUSTOMER: 0, LAPSED: 0 };
    for (const row of journey) byStage[row.journeyStage] = row._count._all;
    return {
      created,
      createdPreviousPeriod,
      createdFromForms,
      erased,
      consent: byStatus,
      journey: byStage,
      // One contact counts once, however often they moved in and out of the stage.
      becameCustomers: customers.length,
    };
  }

  async function formFigures(): Promise<Insights["forms"]> {
    const [forms, perForm, withContact, previous] = await Promise.all([
      prisma.form.findMany({
        where: { organizationId },
        select: { id: true, title: true, status: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_FORMS,
      }),
      prisma.formSubmission.groupBy({
        by: ["formId"],
        where: { organizationId, createdAt: inPeriod },
        _count: { _all: true },
      }),
      prisma.formSubmission.groupBy({
        by: ["formId"],
        where: { organizationId, createdAt: inPeriod, contactId: { not: null } },
        _count: { _all: true },
      }),
      prisma.formSubmission.count({ where: { organizationId, createdAt: inPrevious } }),
    ]);
    const total = new Map(perForm.map((row) => [row.formId, row._count._all]));
    const linked = new Map(withContact.map((row) => [row.formId, row._count._all]));
    return {
      submissions: perForm.reduce((sum, row) => sum + row._count._all, 0),
      submissionsPreviousPeriod: previous,
      submissionsWithContact: withContact.reduce((sum, row) => sum + row._count._all, 0),
      perForm: forms
        .map((form) => ({
          formId: form.id,
          title: form.title,
          status: form.status,
          submissions: total.get(form.id) ?? 0,
          withContact: linked.get(form.id) ?? 0,
        }))
        .sort((a, b) => b.submissions - a.submissions || a.title.localeCompare(b.title)),
    };
  }

  async function meetingFigures(): Promise<Insights["meetings"]> {
    const mine = { organizationId, userId: context.userId, response: { not: "DECLINED" as const } };
    const [upcoming, held, organized, cancelled, responses] = await Promise.all([
      prisma.appointmentAttendee.count({
        where: { ...mine, appointment: { status: "SCHEDULED", startsAt: { gt: now } } },
      }),
      prisma.appointmentAttendee.count({
        where: { ...mine, appointment: { status: "SCHEDULED", endsAt: { gte: from, lte: now } } },
      }),
      prisma.appointment.count({
        where: {
          organizationId,
          organizerId: context.userId,
          status: "SCHEDULED",
          startsAt: inPeriod,
        },
      }),
      prisma.appointment.count({
        where: {
          organizationId,
          organizerId: context.userId,
          status: "CANCELLED",
          startsAt: inPeriod,
        },
      }),
      prisma.appointmentAttendee.groupBy({
        by: ["response"],
        where: {
          organizationId,
          userId: { not: context.userId },
          appointment: {
            organizerId: context.userId,
            status: "SCHEDULED",
            startsAt: inPeriod,
          },
        },
        _count: { _all: true },
      }),
    ]);
    const guestResponses = zeroResponses();
    for (const row of responses) guestResponses[row.response] = row._count._all;
    return { upcoming, held, organized, cancelled, guestResponses };
  }
}
