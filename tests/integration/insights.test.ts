import { beforeEach, describe, expect, it } from "vitest";
import { createContact, eraseContact, recordConsent } from "@/features/crm/server/crm-service";
import {
  createForm,
  getForm,
  setFormStatus,
  submitPublicForm,
} from "@/features/forms/server/forms-service";
import { periodSchema } from "@/features/insights/schemas/insights";
import { getInsights } from "@/features/insights/server/insights-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import {
  cancelAppointment,
  createAppointment,
  respondToAppointment,
} from "@/features/scheduling/server/scheduling-service";
import { db } from "@/lib/db";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const DAY = 86_400_000;
const NOW = new Date("2026-11-30T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });

async function setup() {
  const acme = await createTestOrganization("acme", {
    admin: "ADMIN",
    manager: "MANAGER",
    alice: "MEMBER",
    bob: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    owner: await contextFor("acme", acme.users.owner!.id),
    admin: await contextFor("acme", acme.users.admin!.id),
    manager: await contextFor("acme", acme.users.manager!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    bob: await contextFor("acme", acme.users.bob!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

/** Creates a contact and puts its creation time where the test needs it. */
async function contactAt(context: OrganizationContext, name: string, createdAt: Date) {
  const contact = await createContact(deps(), context, { name });
  await db().crmContact.update({ where: { id: contact.id }, data: { createdAt } });
  return contact;
}

describe("insights", () => {
  beforeEach(resetDatabase);

  it("accepts only the offered periods and otherwise uses 30 days", () => {
    expect([7, 30, 90].map((days) => periodSchema.parse(days))).toEqual([7, 30, 90]);
    expect(periodSchema.parse("7")).toBe(7);
    for (const value of [undefined, "", "5", "abc", "30; DROP", -1, 0, 1000, null, 7.5]) {
      expect(periodSchema.parse(value)).toBe(30);
    }
  });

  it("returns zeros, not gaps or NaN, for an organization with no activity", async () => {
    const { owner } = await setup();
    const report = await getInsights(deps(), owner, 30, NOW);
    expect(report).toMatchObject({
      periodDays: 30,
      contacts: {
        created: 0,
        createdPreviousPeriod: 0,
        createdFromForms: 0,
        erased: 0,
        consent: { GRANTED: 0, UNKNOWN: 0, WITHDRAWN: 0 },
      },
      forms: {
        submissions: 0,
        submissionsPreviousPeriod: 0,
        submissionsWithContact: 0,
        perForm: [],
      },
      meetings: {
        upcoming: 0,
        held: 0,
        organized: 0,
        cancelled: 0,
        guestResponses: { PENDING: 0, ACCEPTED: 0, DECLINED: 0 },
      },
    });
    expect(report.to).toEqual(NOW);
    expect(report.from).toEqual(daysAgo(30));
  });

  describe("sections follow what the caller may see", () => {
    it("gives each role only its own sections", async () => {
      const { owner, manager, alice, viewer } = await setup();
      const sections = async (context: OrganizationContext) => {
        const report = await getInsights(deps(), context, 30, NOW);
        return [report.contacts !== null, report.forms !== null];
      };
      expect(await sections(owner)).toEqual([true, true]);
      expect(await sections(manager)).toEqual([true, true]);
      expect(await sections(alice)).toEqual([true, false]); // members: CRM yes, forms no
      expect(await sections(viewer)).toEqual([false, false]); // viewers: neither
      // Everyone still gets their own meetings.
      expect((await getInsights(deps(), viewer, 30, NOW)).meetings.upcoming).toBe(0);
    });
  });

  describe("contacts and consent", () => {
    it("counts periods without overlap, and members only see their own contacts", async () => {
      const { alice, bob, manager } = await setup();
      await contactAt(alice, "Inside A", daysAgo(1));
      await contactAt(alice, "Inside B", daysAgo(29));
      await contactAt(alice, "Previous", daysAgo(31));
      await contactAt(alice, "Too old", daysAgo(61));
      await contactAt(bob, "Bob's", daysAgo(2));
      await contactAt(alice, "Edge: start of period", daysAgo(30));
      await contactAt(alice, "Edge: end of period", NOW);

      const mine = (await getInsights(deps(), alice, 30, NOW)).contacts!;
      // [from, to): the start of the period is in, the end is out (it belongs to the next period).
      expect(mine.created).toBe(3);
      expect(mine.createdPreviousPeriod).toBe(1);
      expect((await getInsights(deps(), bob, 30, NOW)).contacts!.created).toBe(1);

      const all = (await getInsights(deps(), manager, 30, NOW)).contacts!;
      expect(all.created).toBe(4);
      expect(all.createdPreviousPeriod).toBe(1);
      expect((await getInsights(deps(), manager, 7, NOW)).contacts!.created).toBe(2);
    });

    it("reports consent of contacts that still hold data, and erasures in the period", async () => {
      const { alice, owner } = await setup();
      const granted = await contactAt(alice, "Granted", daysAgo(5));
      const withdrawn = await contactAt(alice, "Withdrawn", daysAgo(5));
      const erased = await contactAt(alice, "Erased", daysAgo(5));
      await contactAt(alice, "Unknown", daysAgo(5));
      await recordConsent(deps(), alice, granted.id, { status: "GRANTED", source: "verbal" });
      await recordConsent(deps(), alice, withdrawn.id, { status: "WITHDRAWN", source: "email" });
      await recordConsent(deps(), alice, erased.id, { status: "GRANTED", source: "verbal" });
      await eraseContact(deps(), owner, erased.id, daysAgo(1));

      const { contacts } = await getInsights(deps(), owner, 30, NOW);
      expect(contacts!.consent).toEqual({ GRANTED: 1, UNKNOWN: 1, WITHDRAWN: 1 });
      expect(contacts!.erased).toBe(1);
      expect((await getInsights(deps(), owner, 7, NOW)).contacts!.erased).toBe(1);
      expect(
        (await getInsights(deps(), owner, 30, new Date(NOW.getTime() + 60 * DAY))).contacts!.erased,
      ).toBe(0);
    });
  });

  describe("forms", () => {
    async function publish(context: OrganizationContext, templateId: string, title: string) {
      const { id } = await createForm(deps(), context, { templateId, title });
      await setFormStatus(deps(), context, id, "PUBLISHED");
      return (await getForm(deps(), context, id)).form;
    }
    const visit = (token: string, answers: Record<string, string>, at: Date, consent = true) =>
      submitPublicForm(deps(), token, answers, consent, at);
    const lead = (n: number) => ({
      name: `Visitor ${n}`,
      email: `visitor${n}@example.test`,
      message: "Hello there",
    });

    it("counts submissions per form and period, and how many became contacts", async () => {
      const { manager, owner } = await setup();
      const contactForm = await publish(manager, "contact_request", "Contact us");
      const feedback = await publish(manager, "feedback", "Feedback");
      await createForm(deps(), manager, { templateId: "feedback", title: "Unpublished draft" });

      await visit(contactForm.publicToken, lead(1), daysAgo(1));
      await visit(contactForm.publicToken, lead(2), daysAgo(2));
      await visit(contactForm.publicToken, lead(3), daysAgo(40)); // previous period
      await visit(contactForm.publicToken, lead(4), daysAgo(90)); // too old
      await visit(feedback.publicToken, { rating: "5" }, daysAgo(3), false);

      const { forms } = await getInsights(deps(), owner, 30, NOW);
      expect(forms).toMatchObject({
        submissions: 3,
        submissionsPreviousPeriod: 1,
        submissionsWithContact: 2,
      });
      expect(forms!.perForm.map((f) => [f.title, f.status, f.submissions, f.withContact])).toEqual([
        ["Contact us", "PUBLISHED", 2, 2],
        ["Feedback", "PUBLISHED", 1, 0],
        ["Unpublished draft", "DRAFT", 0, 0],
      ]);
      expect((await getInsights(deps(), owner, 30, NOW)).contacts!.createdFromForms).toBe(0);
    });

    it("counts new contacts that came in through a form", async () => {
      const { manager } = await setup();
      const form = await publish(manager, "contact_request", "Contact us");
      await visit(form.publicToken, lead(1), daysAgo(1));
      await visit(form.publicToken, lead(2), daysAgo(2));
      await contactAt(manager, "Typed in by hand", daysAgo(1));
      // The contacts were created at the submission times, a day or two ago.
      const { contacts } = await getInsights(deps(), manager, 30, NOW);
      expect(contacts!.createdFromForms).toBe(0); // created "now" in real time, outside the fixed period
      await db().crmContact.updateMany({
        where: { email: { startsWith: "visitor" } },
        data: { createdAt: daysAgo(1) },
      });
      const after = (await getInsights(deps(), manager, 30, NOW)).contacts!;
      expect(after.createdFromForms).toBe(2);
      expect(after.created).toBe(3);
    });
  });

  describe("meetings", () => {
    const CREATED = daysAgo(40);
    const book = (
      context: OrganizationContext,
      startsAt: Date,
      attendeeIds: string[] = [],
      hours = 1,
    ) =>
      createAppointment(
        deps(),
        context,
        { title: "Sync", startsAt, durationMinutes: hours * 60, attendeeIds },
        CREATED,
      );

    it("reports only the caller's own meetings and their guests' answers", async () => {
      const { alice, bob, manager, admin } = await setup();
      const past = await book(alice, daysAgo(10), [bob.userId, manager.userId]);
      await book(alice, daysAgo(5), [bob.userId]);
      await book(alice, new Date(NOW.getTime() + 2 * DAY), [bob.userId]);
      const dropped = await book(alice, daysAgo(3), [bob.userId]);
      await cancelAppointment(deps(), alice, dropped.id, CREATED);
      await respondToAppointment(deps(), bob, past.id, "ACCEPTED");
      await respondToAppointment(deps(), manager, past.id, "DECLINED");

      const a = (await getInsights(deps(), alice, 30, NOW)).meetings;
      expect(a).toEqual({
        upcoming: 1,
        held: 2,
        organized: 2, // the two past ones; the future one starts after the period
        cancelled: 1,
        guestResponses: { ACCEPTED: 1, PENDING: 1, DECLINED: 1 },
      });
      // Bob attends three of them and organizes none; a decline would remove a meeting from his counts.
      const b = (await getInsights(deps(), bob, 30, NOW)).meetings;
      expect(b).toMatchObject({ upcoming: 1, held: 2, organized: 0, cancelled: 0 });
      const m = (await getInsights(deps(), manager, 30, NOW)).meetings;
      expect(m).toMatchObject({ upcoming: 0, held: 0 }); // declined the only one
      // An admin sees nothing of other people's calendars.
      expect((await getInsights(deps(), admin, 30, NOW)).meetings).toEqual({
        upcoming: 0,
        held: 0,
        organized: 0,
        cancelled: 0,
        guestResponses: { PENDING: 0, ACCEPTED: 0, DECLINED: 0 },
      });
    });
  });

  describe("tenant isolation", () => {
    it("never counts another organization's data", async () => {
      const { owner, globexOwner, manager } = await setup();
      await contactAt(globexOwner, "Foreign", daysAgo(1));
      const { id } = await createForm(deps(), globexOwner, {
        templateId: "feedback",
        title: "Foreign form",
      });
      await setFormStatus(deps(), globexOwner, id, "PUBLISHED");
      const { form } = await getForm(deps(), globexOwner, id);
      await submitPublicForm(deps(), form.publicToken, { rating: "5" }, false, daysAgo(1));
      await createAppointment(
        deps(),
        globexOwner,
        { title: "Foreign", startsAt: daysAgo(2), durationMinutes: 30 },
        daysAgo(40),
      );

      const mine = await getInsights(deps(), owner, 30, NOW);
      expect(mine.contacts!.created).toBe(0);
      expect(mine.forms).toMatchObject({ submissions: 0, perForm: [] });
      expect(mine.meetings.organized).toBe(0);
      expect((await getInsights(deps(), manager, 30, NOW)).contacts!.consent).toEqual({
        GRANTED: 0,
        UNKNOWN: 0,
        WITHDRAWN: 0,
      });

      const theirs = await getInsights(deps(), globexOwner, 30, NOW);
      expect(theirs.contacts!.created).toBe(1);
      expect(theirs.forms!.submissions).toBe(1);
      expect(theirs.meetings.organized).toBe(1);
    });
  });
});
