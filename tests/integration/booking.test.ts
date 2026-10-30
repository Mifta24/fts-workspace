import { beforeEach, describe, expect, it } from "vitest";
import {
  bookPublicSlot,
  createBookingPage,
  getBookingPage,
  getPublicBookingPage,
  listBookingPages,
  setBookingPageStatus,
  updateBookingPage,
} from "@/features/booking/server/booking-service";
import { eraseContact, getContactDetail } from "@/features/crm/server/crm-service";
import { listNotifications } from "@/features/notifications/server/notification-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { REMINDER_JOB } from "@/features/scheduling/schemas/scheduling";
import {
  createAppointment,
  respondToAppointment,
  cancelAppointment,
} from "@/features/scheduling/server/scheduling-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Monday 2026-11-02 08:00 UTC.
const NOW = new Date("2026-11-02T08:00:00Z");
const slotAt = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour));

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
    alice: "MEMBER",
    bob: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    globex,
    owner: await contextFor("acme", acme.users.owner!.id),
    admin: await contextFor("acme", acme.users.admin!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    bob: await contextFor("acme", acme.users.bob!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

const settings = (overrides: Record<string, unknown> = {}) => ({
  title: "Intro call",
  description: "Let's talk",
  location: "https://meet.example.test/alice",
  durationMinutes: 60,
  timeZone: "UTC",
  weekdays: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "12:00",
  minNoticeHours: 4,
  maxDaysAhead: 7,
  consentText: "I agree that you may store these details and contact me.",
  ...overrides,
});

async function publishedPage(
  context: OrganizationContext,
  overrides: Record<string, unknown> = {},
) {
  const { id } = await createBookingPage(deps(), context, settings(overrides));
  await setBookingPageStatus(deps(), context, id, "PUBLISHED");
  return getBookingPage(deps(), context, id, NOW);
}

const visitor = (n: number, startsAt: Date, extra: Record<string, unknown> = {}) => ({
  startsAt,
  name: `Visitor ${n}`,
  email: `visitor${n}@example.test`,
  ...extra,
});
const book = (token: string, input: ReturnType<typeof visitor>, now = NOW, consent = true) =>
  bookPublicSlot(deps(), token, input, consent, now);

describe("booking pages", () => {
  beforeEach(resetDatabase);

  describe("management", () => {
    it("creates a draft owned by the caller, with an unguessable link", async () => {
      const { alice, acme } = await setup();
      const { id } = await createBookingPage(deps(), alice, settings({ weekdays: [5, 1, 1, 3] }));
      const page = await getBookingPage(deps(), alice, id, NOW);
      expect(page).toMatchObject({
        status: "DRAFT",
        weekdays: [1, 3, 5],
        startMinute: 540,
        endMinute: 720,
        durationMinutes: 60,
      });
      expect(page.publicToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(page.publicToken).not.toContain(id);
      expect(await db().bookingPage.findUniqueOrThrow({ where: { id } })).toMatchObject({
        ownerId: alice.userId,
        organizationId: acme.organization.id,
      });
      const audit = await db().auditLog.findFirstOrThrow({
        where: { action: "booking_page.created" },
      });
      expect(JSON.stringify(audit)).not.toContain("Intro call");
    });

    it("keeps pages private to their owner, admins included", async () => {
      const { alice, bob, admin, viewer, globexOwner } = await setup();
      const { id } = await createBookingPage(deps(), alice, settings());
      await expectCode(createBookingPage(deps(), viewer, settings()), "FORBIDDEN");
      await expectCode(listBookingPages(deps(), viewer), "FORBIDDEN");
      for (const other of [bob, admin, globexOwner]) {
        await expectCode(getBookingPage(deps(), other, id), "NOT_FOUND");
        await expectCode(updateBookingPage(deps(), other, id, settings()), "NOT_FOUND");
        await expectCode(setBookingPageStatus(deps(), other, id, "PUBLISHED"), "NOT_FOUND");
        expect(await listBookingPages(deps(), other)).toEqual([]);
      }
      expect(await listBookingPages(deps(), alice)).toHaveLength(1);
      await expectCode(getBookingPage(deps(), alice, "not-an-id"), "NOT_FOUND");
    });

    it("rejects settings that cannot work", async () => {
      const { alice } = await setup();
      const bad: Record<string, unknown>[] = [
        { title: "x" },
        { timeZone: "Mars/Olympus" },
        { weekdays: [] },
        { weekdays: [0] },
        { weekdays: [8] },
        { durationMinutes: 25 },
        { start: "12:00", end: "09:00" },
        { start: "09:00", end: "09:30", durationMinutes: 60 },
        { start: "9am" },
        { maxDaysAhead: 91 },
        { maxDaysAhead: 0 },
        { minNoticeHours: -1 },
        { minNoticeHours: 721 },
        { consentText: "short" },
        { description: "x".repeat(1001) },
      ];
      for (const override of bad) {
        await expectCode(createBookingPage(deps(), alice, settings(override)), "INVALID_INPUT");
      }
      expect(await db().bookingPage.count()).toBe(0);
    });

    it("moves through draft, published and closed only in the allowed order", async () => {
      const { alice } = await setup();
      const { id } = await createBookingPage(deps(), alice, settings());
      await expectCode(setBookingPageStatus(deps(), alice, id, "CLOSED"), "UNPROCESSABLE");
      await expectCode(setBookingPageStatus(deps(), alice, id, "nonsense"), "INVALID_INPUT");
      await setBookingPageStatus(deps(), alice, id, "PUBLISHED");
      await setBookingPageStatus(deps(), alice, id, "PUBLISHED"); // no-op
      await expectCode(setBookingPageStatus(deps(), alice, id, "DRAFT"), "UNPROCESSABLE");
      await setBookingPageStatus(deps(), alice, id, "CLOSED");
      await setBookingPageStatus(deps(), alice, id, "PUBLISHED");
      expect(await db().auditLog.count({ where: { action: "booking_page.status_changed" } })).toBe(
        3,
      );
    });

    it("locks the consent wording after publishing but allows other changes", async () => {
      const { alice } = await setup();
      const { id } = await createBookingPage(deps(), alice, settings());
      await updateBookingPage(
        deps(),
        alice,
        id,
        settings({ consentText: "A new consent statement." }),
      );
      await setBookingPageStatus(deps(), alice, id, "PUBLISHED");
      await expectCode(
        updateBookingPage(deps(), alice, id, settings({ consentText: "Different wording now." })),
        "UNPROCESSABLE",
      );
      await updateBookingPage(
        deps(),
        alice,
        id,
        settings({ consentText: "A new consent statement.", title: "Renamed", maxDaysAhead: 14 }),
      );
      expect(await getBookingPage(deps(), alice, id, NOW)).toMatchObject({
        title: "Renamed",
        maxDaysAhead: 14,
        consentText: "A new consent statement.",
      });
    });
  });

  describe("what visitors see", () => {
    it("shows the free slots of a published page and nothing else about the owner", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      const view = await getPublicBookingPage(deps(), page.publicToken, NOW);
      expect(view).toMatchObject({
        title: "Intro call",
        organizationName: "acme",
        durationMinutes: 60,
        timeZone: "UTC",
      });
      // Monday's slots start before now + 4 h, so the first offer is Tuesday 3 November 09:00.
      expect(view.slots[0]).toEqual(slotAt(3, 9));
      expect(JSON.stringify(view)).not.toMatch(/ownerId|organizationId|Test acme/i);
    });

    it("treats unknown, malformed, draft, closed and ownerless pages the same way", async () => {
      const { alice, acme } = await setup();
      const { id } = await createBookingPage(deps(), alice, settings());
      const draft = (await getBookingPage(deps(), alice, id, NOW)).publicToken;
      for (const token of [draft, "", "short", "a".repeat(22), "!".repeat(22), "a".repeat(65)]) {
        await expectCode(getPublicBookingPage(deps(), token, NOW), "NOT_FOUND");
      }
      await setBookingPageStatus(deps(), alice, id, "PUBLISHED");
      await expect(getPublicBookingPage(deps(), draft, NOW)).resolves.toBeDefined();
      await setBookingPageStatus(deps(), alice, id, "CLOSED");
      await expectCode(getPublicBookingPage(deps(), draft, NOW), "NOT_FOUND");
      await setBookingPageStatus(deps(), alice, id, "PUBLISHED");
      await db().member.update({
        where: {
          organizationId_userId: { organizationId: acme.organization.id, userId: alice.userId },
        },
        data: { status: "DISABLED" },
      });
      await expectCode(getPublicBookingPage(deps(), draft, NOW), "NOT_FOUND");
      await expectCode(book(draft, visitor(1, slotAt(3, 9))), "NOT_FOUND");
    });

    it("hides times when the owner is busy, and frees them again when they decline or cancel", async () => {
      const { alice, bob } = await setup();
      const page = await publishedPage(alice);
      const slots = async () =>
        (await getPublicBookingPage(deps(), page.publicToken, NOW)).slots.map((s) => s.getTime());

      expect(await slots()).toContain(slotAt(3, 10).getTime());
      const own = await createAppointment(
        deps(),
        alice,
        { title: "Private dentist", startsAt: slotAt(3, 10), durationMinutes: 60 },
        NOW,
      );
      expect(await slots()).not.toContain(slotAt(3, 10).getTime());
      expect(await slots()).toContain(slotAt(3, 9).getTime());
      expect(await slots()).toContain(slotAt(3, 11).getTime());
      await cancelAppointment(deps(), alice, own.id, NOW);
      expect(await slots()).toContain(slotAt(3, 10).getTime());

      const invited = await createAppointment(
        deps(),
        bob,
        {
          title: "Bob's meeting",
          startsAt: slotAt(3, 11),
          durationMinutes: 60,
          attendeeIds: [alice.userId],
        },
        NOW,
      );
      expect(await slots()).not.toContain(slotAt(3, 11).getTime());
      await respondToAppointment(deps(), alice, invited.id, "DECLINED");
      expect(await slots()).toContain(slotAt(3, 11).getTime());
    });
  });

  describe("booking", () => {
    it("books a slot: meeting, lead, consent, reminder, notification and a clean audit trail", async () => {
      const { alice, acme } = await setup();
      const page = await publishedPage(alice);
      const result = await book(
        page.publicToken,
        visitor(1, slotAt(3, 10), { email: "Pat@Visitor.TEST", note: "Call me about pricing" }),
      );
      expect(result).toMatchObject({ title: "Intro call", timeZone: "UTC" });
      expect(result.endsAt).toEqual(slotAt(3, 11));

      const meeting = await db().appointment.findFirstOrThrow({
        include: { attendees: true, contact: true },
      });
      expect(meeting).toMatchObject({
        organizationId: acme.organization.id,
        organizerId: alice.userId,
        bookingPageId: page.id,
        title: "Intro call",
        description: "Call me about pricing",
        location: "https://meet.example.test/alice",
        status: "SCHEDULED",
        reminderMinutes: 15,
      });
      expect(meeting.startsAt).toEqual(slotAt(3, 10));
      expect(meeting.attendees).toEqual([
        expect.objectContaining({ userId: alice.userId, response: "ACCEPTED" }),
      ]);
      expect(meeting.contact).toMatchObject({
        name: "Visitor 1",
        email: "pat@visitor.test",
        ownerId: alice.userId,
        consentStatus: "GRANTED",
        journeyStage: "LEAD",
      });

      const consent = await db().consentEvent.findFirstOrThrow({
        where: { contactId: meeting.contactId! },
      });
      expect(consent).toMatchObject({
        status: "GRANTED",
        source: "booking: Intro call",
        recordedById: alice.userId,
      });
      expect(
        await db().contactStageChange.count({
          where: { contactId: meeting.contactId!, reason: "CREATED" },
        }),
      ).toBe(1);

      const [note] = await listNotifications(deps(), alice);
      expect(note).toMatchObject({
        type: "BOOKING_RECEIVED",
        resourceTitle: "Intro call",
        actorName: null,
      });
      const job = await db().job.findFirstOrThrow({ where: { type: REMINDER_JOB } });
      expect(job.runAt).toEqual(new Date(slotAt(3, 10).getTime() - 15 * 60_000));

      const audit = await db().auditLog.findFirstOrThrow({ where: { action: "booking.created" } });
      expect(audit).toMatchObject({ actorId: null, resourceId: meeting.id });
      expect(JSON.stringify(audit)).not.toMatch(/Visitor|visitor|pricing/);
      // The slot is gone for the next visitor.
      const after = await getPublicBookingPage(deps(), page.publicToken, NOW);
      expect(after.slots.map((s) => s.getTime())).not.toContain(slotAt(3, 10).getTime());
    });

    it("links an existing contact instead of duplicating it, and records consent once", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      await book(page.publicToken, visitor(1, slotAt(3, 9)));
      await book(page.publicToken, visitor(1, slotAt(3, 11), { name: "Someone Else" }));
      expect(await db().crmContact.count()).toBe(1);
      expect((await db().crmContact.findFirstOrThrow()).name).toBe("Visitor 1");
      expect(await db().consentEvent.count()).toBe(1);
      expect(await db().appointment.count({ where: { contactId: { not: null } } })).toBe(2);
    });

    it("accepts only start times the page offers right now", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      const offered = slotAt(3, 9);
      const refused: Date[] = [
        slotAt(3, 8), // before working hours
        slotAt(3, 12), // after working hours (the last slot ends at 12:00)
        new Date(slotAt(3, 9).getTime() + 30 * 60_000), // off the slot grid
        slotAt(2, 9), // in the past
        slotAt(2, 10), // inside the minimum notice (now + 4 h = 12:00)
        slotAt(7, 9), // Saturday
        slotAt(30, 9), // beyond the horizon
        new Date("invalid"),
      ];
      for (const startsAt of refused) {
        await expect(book(page.publicToken, visitor(1, startsAt))).rejects.toBeInstanceOf(AppError);
      }
      expect(await db().appointment.count()).toBe(0);
      await expect(book(page.publicToken, visitor(1, offered))).resolves.toBeDefined();
    });

    it("needs consent and valid details", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      await expectCode(
        book(page.publicToken, visitor(1, slotAt(3, 9)), NOW, false),
        "INVALID_INPUT",
      );
      for (const extra of [
        { name: "x" },
        { email: "nope" },
        { email: "" },
        { note: "n".repeat(501) },
      ]) {
        await expectCode(book(page.publicToken, visitor(1, slotAt(3, 9), extra)), "INVALID_INPUT");
      }
      await expectCode(
        bookPublicSlot(
          deps(),
          page.publicToken,
          { ...visitor(1, slotAt(3, 9)), note: "n".repeat(5000) },
          true,
          NOW,
        ),
        "INVALID_INPUT",
      );
      expect(await db().crmContact.count()).toBe(0);
      expect(await db().appointment.count()).toBe(0);
    });

    it("lets only one of two simultaneous visitors have the same slot", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      const results = await Promise.allSettled([
        book(page.publicToken, visitor(1, slotAt(3, 9))),
        book(page.publicToken, visitor(2, slotAt(3, 9))),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(failure.reason).toMatchObject({ code: "CONFLICT" });
      expect(await db().appointment.count()).toBe(1);
    });

    it("blocks the owner's own double-booking of a slot a visitor took", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      await book(page.publicToken, visitor(1, slotAt(3, 9)));
      await expectCode(
        createAppointment(
          deps(),
          alice,
          { title: "Clash", startsAt: slotAt(3, 9), durationMinutes: 30 },
          NOW,
        ),
        "CONFLICT",
      );
    });

    it("limits upcoming bookings per email, and bookings per minute and per day", async () => {
      const { alice, acme } = await setup();
      const page = await publishedPage(alice);
      await book(page.publicToken, visitor(1, slotAt(3, 9)));
      await book(page.publicToken, visitor(1, slotAt(3, 10)));
      await expectCode(book(page.publicToken, visitor(1, slotAt(3, 11))), "RATE_LIMITED");
      await expect(book(page.publicToken, visitor(2, slotAt(3, 11)))).resolves.toBeDefined();

      // Volume limits count by creation time, so use the real clock and slots that exist today.
      const now = new Date();
      const wide = await publishedPage(alice, {
        title: "Wide open",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        start: "00:00",
        end: "23:45",
        durationMinutes: 15,
        minNoticeHours: 0,
        maxDaysAhead: 5,
      });
      const slots = (await getPublicBookingPage(deps(), wide.publicToken, now)).slots;
      for (let i = 0; i < 10; i++) {
        await bookPublicSlot(deps(), wide.publicToken, visitor(100 + i, slots[i]!), true, now);
      }
      await expectCode(
        bookPublicSlot(deps(), wide.publicToken, visitor(200, slots[10]!), true, now),
        "RATE_LIMITED",
      );

      // A page that already took 100 bookings today takes no more.
      const full = await publishedPage(alice, {
        title: "Busy page",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        start: "00:00",
        end: "23:45",
        durationMinutes: 15,
        minNoticeHours: 0,
        maxDaysAhead: 5,
      });
      const earlier = new Date(now.getTime() - 2 * HOUR);
      await db().appointment.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          organizationId: acme.organization.id,
          title: "Filler",
          startsAt: new Date(now.getTime() + (100 + i) * DAY),
          endsAt: new Date(now.getTime() + (100 + i) * DAY + HOUR),
          organizerId: alice.userId,
          bookingPageId: full.id,
          createdAt: earlier,
        })),
      });
      const openSlot = (await getPublicBookingPage(deps(), full.publicToken, now)).slots[0]!;
      await expectCode(
        bookPublicSlot(deps(), full.publicToken, visitor(300, openSlot), true, now),
        "RATE_LIMITED",
      );
    });

    it("erases the visitor's note with the contact but keeps the meeting", async () => {
      const { alice, owner } = await setup();
      const page = await publishedPage(alice);
      await book(page.publicToken, visitor(1, slotAt(3, 9), { note: "My medical situation" }));
      const meeting = await db().appointment.findFirstOrThrow();
      await eraseContact(deps(), owner, meeting.contactId!);
      const after = await db().appointment.findUniqueOrThrow({ where: { id: meeting.id } });
      expect(after).toMatchObject({ description: null, status: "SCHEDULED" });
      expect((await getContactDetail(deps(), alice, meeting.contactId!)).contact.erased).toBe(true);
    });
  });

  describe("tenant isolation", () => {
    it("takes the organization from the page, never from the visitor or the owner's other memberships", async () => {
      const { alice, globexOwner, globex, acme } = await setup();
      const page = await publishedPage(alice);
      // Alice also belongs to globex; a meeting there does not block acme slots.
      await db().member.create({
        data: { organizationId: globex.organization.id, userId: alice.userId, role: "MEMBER" },
      });
      const inGlobex = await contextFor("globex", alice.userId);
      await createAppointment(
        deps(),
        inGlobex,
        { title: "Elsewhere", startsAt: slotAt(3, 9), durationMinutes: 60 },
        NOW,
      );
      const view = await getPublicBookingPage(deps(), page.publicToken, NOW);
      expect(view.slots.map((s) => s.getTime())).toContain(slotAt(3, 9).getTime());

      await book(page.publicToken, visitor(1, slotAt(3, 9)));
      expect(await db().crmContact.count({ where: { organizationId: acme.organization.id } })).toBe(
        1,
      );
      expect(
        await db().crmContact.count({ where: { organizationId: globex.organization.id } }),
      ).toBe(0);
      expect(await listBookingPages(deps(), globexOwner)).toEqual([]);
    });

    it("rejects an appointment that points at another organization's booking page", async () => {
      const { alice, globexOwner, acme } = await setup();
      const foreign = await publishedPage(globexOwner);
      await expect(
        db().appointment.create({
          data: {
            organizationId: acme.organization.id,
            title: "Cross",
            startsAt: slotAt(3, 9),
            endsAt: slotAt(3, 10),
            organizerId: alice.userId,
            bookingPageId: foreign.id,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db().bookingPage.update({ where: { id: foreign.id }, data: { weekdays: [] } }),
      ).rejects.toThrow();
    });
  });
});
