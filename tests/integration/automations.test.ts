import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTOMATION_JOB,
  RULE_KEYS,
  type RuleKey,
} from "@/features/automations/schemas/automations";
import { runAutomation } from "@/features/automations/server/automation-runner";
import { listRules, setRuleEnabled } from "@/features/automations/server/automation-service";
import {
  bookPublicSlot,
  createBookingPage,
  getBookingPage,
  setBookingPageStatus,
} from "@/features/booking/server/booking-service";
import { eraseContact } from "@/features/crm/server/crm-service";
import {
  createForm,
  getForm,
  setFormStatus,
  submitPublicForm,
} from "@/features/forms/server/forms-service";
import { listNotifications } from "@/features/notifications/server/notification-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { runJobs } from "@/server/jobs/queue";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const DAY = 86_400_000;
// Monday 2040-01-02 08:00 UTC. Far enough ahead that the real clock never passes it: jobs are created
// with the database's own time and must be due at this fixed "now".
const NOW = new Date("2040-01-02T08:00:00Z");
const slotAt = (day: number, hour: number) => new Date(Date.UTC(2040, 0, day, hour));

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });

async function setup() {
  const acme = await createTestOrganization("acme", {
    admin: "ADMIN",
    manager: "MANAGER",
    alice: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    globex,
    owner: await contextFor("acme", acme.users.owner!.id),
    admin: await contextFor("acme", acme.users.admin!.id),
    manager: await contextFor("acme", acme.users.manager!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

const enable = (context: OrganizationContext, key: RuleKey, on = true) =>
  setRuleEnabled(deps(), context, key, on);

/** Runs the due automation jobs the way the worker would. */
const work = (now = NOW) =>
  runJobs(
    db(),
    { [AUTOMATION_JOB]: (job) => runAutomation({ prisma: db() }, job, now) },
    { now: () => now },
  );

async function publishedForm(context: OrganizationContext, title = "Contact us") {
  const { id } = await createForm(deps(), context, { templateId: "contact_request", title });
  await setFormStatus(deps(), context, id, "PUBLISHED");
  return (await getForm(deps(), context, id)).form;
}

const answers = (n = 1) => ({
  name: `Dana Visitor ${n}`,
  email: `dana${n}@visitor.test`,
  company: "Visitor Inc",
  message: "Please call me about pricing.",
});
const submit = (token: string, n = 1) =>
  submitPublicForm(deps(), token, answers(n), true, new Date(NOW.getTime() + n));

const bookingSettings = {
  title: "Intro call",
  durationMinutes: 60,
  timeZone: "UTC",
  weekdays: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "12:00",
  minNoticeHours: 4,
  maxDaysAhead: 7,
  consentText: "I agree that you may store these details and contact me.",
};

async function publishedPage(context: OrganizationContext) {
  const { id } = await createBookingPage(deps(), context, bookingSettings);
  await setBookingPageStatus(deps(), context, id, "PUBLISHED");
  return getBookingPage(deps(), context, id, NOW);
}

const book = (token: string, n = 1, startsAt = slotAt(3, 9)) =>
  bookPublicSlot(
    deps(),
    token,
    { startsAt, name: `Pat Booker ${n}`, email: `pat${n}@booker.test`, note: "Private note" },
    true,
    NOW,
  );

const jobs = () => db().job.findMany({ where: { type: AUTOMATION_JOB }, orderBy: { id: "asc" } });

describe("automations", () => {
  beforeEach(resetDatabase);

  describe("choosing rules", () => {
    it("lists every built-in rule, all off until someone turns one on", async () => {
      const { owner } = await setup();
      expect(await listRules(deps(), owner)).toEqual(
        RULE_KEYS.map((key) => ({ key, enabled: false })),
      );
    });

    it("lets only owners and admins choose, and audits the choice", async () => {
      const { owner, admin, manager, alice, viewer, acme } = await setup();
      for (const context of [manager, alice, viewer]) {
        await expectCode(listRules(deps(), context), "FORBIDDEN");
        await expectCode(enable(context, "FORM_SUBMITTED_TASK"), "FORBIDDEN");
      }
      await enable(admin, "FORM_SUBMITTED_TASK");
      expect(
        (await listRules(deps(), owner)).find((rule) => rule.key === "FORM_SUBMITTED_TASK"),
      ).toEqual({ key: "FORM_SUBMITTED_TASK", enabled: true });
      await enable(owner, "FORM_SUBMITTED_TASK", false);
      expect(
        (await listRules(deps(), owner)).find((rule) => rule.key === "FORM_SUBMITTED_TASK")
          ?.enabled,
      ).toBe(false);
      const audit = await db().auditLog.findMany({
        where: { organizationId: acme.organization.id, resourceType: "automation_rule" },
        orderBy: { createdAt: "asc" },
      });
      expect(audit.map((entry) => entry.action)).toEqual([
        "automation.enabled",
        "automation.disabled",
      ]);
      expect(audit[0]).toMatchObject({ actorId: admin.userId });
    });

    it("rejects choices that are not built-in rules", async () => {
      const { owner } = await setup();
      await expectCode(setRuleEnabled(deps(), owner, "SEND_EMAILS", true), "INVALID_INPUT");
      await expectCode(
        setRuleEnabled(deps(), owner, "FORM_SUBMITTED_TASK", "yes"),
        "INVALID_INPUT",
      );
      await expectCode(setRuleEnabled(deps(), owner, undefined, true), "INVALID_INPUT");
    });

    it("keeps each workspace's choices to itself", async () => {
      const { owner, globexOwner } = await setup();
      await enable(owner, "FORM_SUBMITTED_NOTIFY");
      expect((await listRules(deps(), globexOwner)).every((rule) => !rule.enabled)).toBe(true);
    });
  });

  describe("when a public form is submitted", () => {
    it("does nothing while no rule is on", async () => {
      const { manager } = await setup();
      const form = await publishedForm(manager);
      await submit(form.publicToken);
      expect(await jobs()).toEqual([]);
      expect(await db().task.count()).toBe(0);
    });

    it("tells the form's owner, once for a run of submissions", async () => {
      const { manager, owner, admin } = await setup();
      await enable(owner, "FORM_SUBMITTED_NOTIFY");
      const form = await publishedForm(manager);
      await submit(form.publicToken, 1);
      await submit(form.publicToken, 2);

      // The queued jobs carry identifiers only, never what the visitor typed.
      const queued = await jobs();
      expect(queued).toHaveLength(2);
      const payloads = JSON.stringify(queued.map((job) => job.payload));
      for (const secret of ["Dana", "visitor.test", "pricing", "Visitor Inc"]) {
        expect(payloads).not.toContain(secret);
      }

      expect(await work()).toMatchObject({ done: 2, failed: 0 });
      const notes = (await listNotifications(deps(), manager)).filter(
        (item) => item.type === "FORM_SUBMITTED",
      );
      expect(notes).toHaveLength(1); // one unread per form is enough
      expect(notes[0]).toMatchObject({
        resourceType: "form",
        resourceId: form.id,
        resourceTitle: "Contact us",
        actorName: null,
      });
      // Nobody else is told, admins included.
      for (const other of [owner, admin]) {
        expect(
          (await listNotifications(deps(), other)).filter((item) => item.type === "FORM_SUBMITTED"),
        ).toEqual([]);
      }
    });

    it("creates a follow-up task for the owner without the visitor's words", async () => {
      const { manager, owner, acme } = await setup();
      await enable(owner, "FORM_SUBMITTED_TASK");
      const form = await publishedForm(manager, "Spring offer");
      await submit(form.publicToken);
      await work();

      const [task] = await db().task.findMany();
      expect(task).toMatchObject({
        organizationId: acme.organization.id,
        title: "Follow up: Spring offer",
        assigneeId: manager.userId,
        createdById: manager.userId,
        status: "TODO",
      });
      expect(task!.dueAt!.getTime()).toBe(NOW.getTime() + 2 * DAY);
      expect(JSON.stringify(task)).not.toMatch(/Dana|visitor\.test|pricing/);

      const assigned = (await listNotifications(deps(), manager)).filter(
        (item) => item.type === "TASK_ASSIGNED",
      );
      expect(assigned).toHaveLength(1);
      expect(assigned[0]).toMatchObject({
        actorName: null,
        resourceTitle: "Follow up: Spring offer",
      });

      const audit = await db().auditLog.findFirstOrThrow({
        where: { action: "automation.executed" },
      });
      expect(audit).toMatchObject({ actorId: null, resourceType: "task", resourceId: task!.id });
      expect(JSON.stringify(audit)).not.toMatch(/Dana|visitor\.test|pricing/);
    });

    it("acts once even if the same job runs again", async () => {
      const { manager, owner } = await setup();
      await enable(owner, "FORM_SUBMITTED_TASK");
      const form = await publishedForm(manager);
      await submit(form.publicToken);
      const [job] = await jobs();
      const claimed = { ...job!, attempts: 1, maxAttempts: 3 };
      await runAutomation({ prisma: db() }, claimed, NOW);
      await runAutomation({ prisma: db() }, claimed, NOW);
      await work();
      expect(await db().task.count()).toBe(1);
      expect(await db().automationRun.count()).toBe(1);
    });

    it("does not act on a rule that was switched off after the job was queued", async () => {
      const { manager, owner } = await setup();
      await enable(owner, "FORM_SUBMITTED_TASK");
      const form = await publishedForm(manager);
      await submit(form.publicToken);
      await enable(owner, "FORM_SUBMITTED_TASK", false);
      expect(await work()).toMatchObject({ done: 1, failed: 0 });
      expect(await db().task.count()).toBe(0);
    });

    it("leaves earlier submissions alone when a rule is switched on later", async () => {
      const { manager, owner } = await setup();
      const form = await publishedForm(manager);
      await submit(form.publicToken, 1);
      await enable(owner, "FORM_SUBMITTED_TASK");
      await work();
      expect(await db().task.count()).toBe(0);
      await submit(form.publicToken, 2);
      await work();
      expect(await db().task.count()).toBe(1);
    });

    it("does nothing for an owner who has left the workspace", async () => {
      const { manager, owner, acme } = await setup();
      await enable(owner, "FORM_SUBMITTED_TASK");
      await enable(owner, "FORM_SUBMITTED_NOTIFY");
      const form = await publishedForm(manager);
      await submit(form.publicToken);
      await db().member.update({
        where: {
          organizationId_userId: { organizationId: acme.organization.id, userId: manager.userId },
        },
        data: { status: "DISABLED" },
      });
      await work();
      expect(await db().task.count()).toBe(0);
      expect(await db().notification.count({ where: { userId: manager.userId } })).toBe(0);
    });

    it("never lets a job reach another workspace's form", async () => {
      const { manager, owner, globexOwner, acme, globex } = await setup();
      await enable(owner, "FORM_SUBMITTED_TASK");
      await enable(globexOwner, "FORM_SUBMITTED_TASK"); // the rule is on there too
      const form = await publishedForm(manager);
      await submit(form.publicToken);
      const submission = await db().formSubmission.findFirstOrThrow();
      // A job filed under globex that names acme's form and submission.
      await db().job.create({
        data: {
          organizationId: globex.organization.id,
          type: AUTOMATION_JOB,
          payload: {
            ruleKey: "FORM_SUBMITTED_TASK",
            formId: form.id,
            submissionId: submission.id,
          },
        },
      });
      await db().job.deleteMany({ where: { organizationId: acme.organization.id } });
      expect(await work()).toMatchObject({ failed: 0 });
      expect(await db().task.count()).toBe(0);
      expect(await db().notification.count()).toBe(0);
    });

    it("fails a job it cannot understand instead of guessing", async () => {
      const { owner, acme } = await setup();
      await db().job.create({
        data: {
          organizationId: acme.organization.id,
          type: AUTOMATION_JOB,
          payload: { ruleKey: "DELETE_EVERYTHING" },
          maxAttempts: 1,
        },
      });
      expect(await work()).toEqual({ done: 0, retried: 0, failed: 1 });
      expect(owner.userId).toBeTruthy();
    });
  });

  describe("when someone books a time", () => {
    it("adds a note with the meeting's name and time to the contact", async () => {
      const { alice, owner, acme } = await setup();
      await enable(owner, "BOOKING_RECEIVED_NOTE");
      const page = await publishedPage(alice);
      await book(page.publicToken);
      await work();
      const [note] = await db().crmActivity.findMany();
      expect(note).toMatchObject({
        organizationId: acme.organization.id,
        type: "NOTE",
        authorId: alice.userId,
        body: "Booked a meeting: Intro call (2040-01-03 09:00 UTC)",
      });
      // The visitor's own words and address are not copied into the note or the trail.
      expect(JSON.stringify(note)).not.toMatch(/Private note|booker\.test/);
      const audit = await db().auditLog.findFirstOrThrow({
        where: { action: "automation.executed" },
      });
      expect(JSON.stringify(audit)).not.toMatch(/Private note|booker\.test|Pat/);
    });

    it("adds nothing for a contact who was erased in the meantime", async () => {
      const { alice, owner } = await setup();
      await enable(owner, "BOOKING_RECEIVED_NOTE");
      const page = await publishedPage(alice);
      await book(page.publicToken);
      const contact = await db().crmContact.findFirstOrThrow();
      await eraseContact(deps(), owner, contact.id);
      await work();
      expect(await db().crmActivity.count()).toBe(0);
    });

    it("does nothing while the rule is off", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      await book(page.publicToken);
      expect(await jobs()).toEqual([]);
      expect(await db().crmActivity.count()).toBe(0);
    });
  });
});
