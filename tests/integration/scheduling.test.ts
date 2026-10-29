import { beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/features/crm/server/crm-service";
import { listNotifications } from "@/features/notifications/server/notification-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import {
  cancelAppointment,
  createAppointment,
  listAppointments,
  rescheduleAppointment,
  respondToAppointment,
} from "@/features/scheduling/server/scheduling-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const HOUR = 3_600_000;
const NOW = new Date("2026-11-02T08:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

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
    carol: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    owner: await contextFor("acme", acme.users.owner!.id),
    admin: await contextFor("acme", acme.users.admin!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    bob: await contextFor("acme", acme.users.bob!.id),
    carol: await contextFor("acme", acme.users.carol!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

const meeting = (startsAt: Date, overrides: Record<string, unknown> = {}) => ({
  title: "Planning",
  startsAt,
  durationMinutes: 60,
  attendeeIds: [] as string[],
  ...overrides,
});

const book = (
  context: OrganizationContext,
  startsAt: Date,
  overrides: Record<string, unknown> = {},
) => createAppointment(deps(), context, meeting(startsAt, overrides), NOW);

describe("scheduling", () => {
  beforeEach(resetDatabase);

  it("creates a meeting with the organizer accepted, guests pending and invitations sent", async () => {
    const { alice, bob, carol } = await setup();
    const { id } = await book(alice, at(24), {
      attendeeIds: [bob.userId, carol.userId, bob.userId, alice.userId],
    });
    const [view] = await listAppointments(deps(), bob, {}, NOW);
    expect(view).toMatchObject({
      id,
      title: "Planning",
      mine: false,
      myResponse: "PENDING",
      organizerName: "Test acme-alice",
    });
    expect(view!.attendees.map((a) => [a.userId, a.response]).sort()).toEqual(
      [
        [alice.userId, "ACCEPTED"],
        [bob.userId, "PENDING"],
        [carol.userId, "PENDING"],
      ].sort(),
    );
    expect(view!.endsAt.getTime() - view!.startsAt.getTime()).toBe(HOUR);
    const [note] = await listNotifications(deps(), bob);
    expect(note).toMatchObject({
      type: "APPOINTMENT_INVITED",
      resourceTitle: "Planning",
      actorName: "Test acme-alice",
    });
    expect(await listNotifications(deps(), alice)).toEqual([]);
    const audit = await db().auditLog.findFirstOrThrow({
      where: { action: "appointment.created" },
    });
    expect(audit.metadata).toEqual({ attendees: 3 });
  });

  it("validates the time window, attendees and permissions", async () => {
    const { alice, viewer, globexOwner, acme } = await setup();
    await expectCode(book(alice, new Date(NOW.getTime() - HOUR)), "UNPROCESSABLE");
    await expectCode(book(alice, new Date(NOW.getTime() + 800 * 24 * HOUR)), "UNPROCESSABLE");
    await expectCode(book(alice, at(2), { durationMinutes: 1 }), "INVALID_INPUT");
    await expectCode(book(alice, at(2), { durationMinutes: 1441 }), "INVALID_INPUT");
    await expectCode(book(alice, at(2), { title: "x" }), "INVALID_INPUT");
    await expectCode(
      book(alice, at(2), { attendeeIds: Array.from({ length: 21 }, () => crypto.randomUUID()) }),
      "INVALID_INPUT",
    );
    await expectCode(book(alice, at(2), { attendeeIds: [globexOwner.userId] }), "UNPROCESSABLE");
    await expectCode(book(viewer, at(2)), "FORBIDDEN");
    await db().member.update({
      where: {
        organizationId_userId: { organizationId: acme.organization.id, userId: viewer.userId },
      },
      data: { status: "DISABLED" },
    });
    await expectCode(book(alice, at(2), { attendeeIds: [viewer.userId] }), "UNPROCESSABLE");
    expect(await db().appointment.count()).toBe(0);
  });

  describe("conflicts", () => {
    it("refuses overlaps for the organizer and for guests, without saying who is busy", async () => {
      const { alice, bob, carol } = await setup();
      await book(alice, at(24), { attendeeIds: [bob.userId] });
      await expectCode(book(alice, at(24.5)), "CONFLICT");
      await expectCode(book(carol, at(23.5), { attendeeIds: [bob.userId] }), "CONFLICT");
      await expect(book(carol, at(24.5), { attendeeIds: [bob.userId] })).rejects.toThrow(
        "Someone is already booked at that time.",
      );
      // Touching meetings do not overlap.
      await expect(book(alice, at(25))).resolves.toBeDefined();
      await expect(book(alice, at(23))).resolves.toBeDefined();
    });

    it("frees people who declined and slots of cancelled meetings", async () => {
      const { alice, bob, carol } = await setup();
      const first = await book(alice, at(24), { attendeeIds: [bob.userId] });
      await respondToAppointment(deps(), bob, first.id, "DECLINED");
      await expect(book(carol, at(24), { attendeeIds: [bob.userId] })).resolves.toBeDefined();
      await cancelAppointment(deps(), alice, first.id);
      await expect(book(alice, at(24))).resolves.toBeDefined();
    });

    it("accepting after declining re-checks for new conflicts", async () => {
      const { alice, bob, carol } = await setup();
      const first = await book(alice, at(24), { attendeeIds: [bob.userId] });
      await respondToAppointment(deps(), bob, first.id, "DECLINED");
      await book(carol, at(24), { attendeeIds: [bob.userId] });
      await expectCode(respondToAppointment(deps(), bob, first.id, "ACCEPTED"), "CONFLICT");
    });

    it("lets only one of two simultaneous bookings for the same person win", async () => {
      const { alice, bob, carol } = await setup();
      const results = await Promise.allSettled([
        book(alice, at(30), { attendeeIds: [carol.userId] }),
        book(bob, at(30), { attendeeIds: [carol.userId] }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db().appointment.count()).toBe(1);
    });
  });

  describe("responses, rescheduling and cancelling", () => {
    it("lets attendees answer, but not organizers decline or outsiders answer", async () => {
      const { alice, bob, admin } = await setup();
      const { id } = await book(alice, at(24), { attendeeIds: [bob.userId] });
      await respondToAppointment(deps(), bob, id, "ACCEPTED");
      expect((await listAppointments(deps(), bob, {}, NOW))[0]!.myResponse).toBe("ACCEPTED");
      await expectCode(respondToAppointment(deps(), alice, id, "DECLINED"), "UNPROCESSABLE");
      await expectCode(respondToAppointment(deps(), admin, id, "ACCEPTED"), "NOT_FOUND");
      await expectCode(respondToAppointment(deps(), bob, id, "MAYBE"), "INVALID_INPUT");
      await expectCode(respondToAppointment(deps(), bob, "nope", "ACCEPTED"), "NOT_FOUND");
    });

    it("reschedules for the organizer only, resets answers and notifies", async () => {
      const { alice, bob } = await setup();
      const { id } = await book(alice, at(24), { attendeeIds: [bob.userId] });
      await respondToAppointment(deps(), bob, id, "ACCEPTED");
      await expectCode(
        rescheduleAppointment(deps(), bob, id, { startsAt: at(48), durationMinutes: 30 }, NOW),
        "NOT_FOUND",
      );

      // Moving within its own old slot is not a conflict with itself.
      await rescheduleAppointment(
        deps(),
        alice,
        id,
        { startsAt: at(24.25), durationMinutes: 30 },
        NOW,
      );
      const [view] = await listAppointments(deps(), bob, {}, NOW);
      expect(view).toMatchObject({ myResponse: "PENDING" });
      expect(view!.endsAt.getTime() - view!.startsAt.getTime()).toBe(30 * 60_000);
      expect(view!.attendees.find((a) => a.userId === alice.userId)!.response).toBe("ACCEPTED");
      expect((await listNotifications(deps(), bob)).map((n) => n.type)).toContain(
        "APPOINTMENT_UPDATED",
      );

      await book(alice, at(50));
      await expectCode(
        rescheduleAppointment(deps(), alice, id, { startsAt: at(50), durationMinutes: 30 }, NOW),
        "CONFLICT",
      );
      await expectCode(
        rescheduleAppointment(
          deps(),
          alice,
          id,
          { startsAt: new Date(NOW.getTime() - 3 * HOUR), durationMinutes: 30 },
          NOW,
        ),
        "UNPROCESSABLE",
      );
    });

    it("cancels for the organizer only, notifies, is idempotent and ends further changes", async () => {
      const { alice, bob } = await setup();
      const { id } = await book(alice, at(24), { attendeeIds: [bob.userId] });
      await expectCode(cancelAppointment(deps(), bob, id), "NOT_FOUND");
      await cancelAppointment(deps(), alice, id);
      await cancelAppointment(deps(), alice, id);
      expect(await listAppointments(deps(), bob, {}, NOW)).toEqual([]);
      expect((await listNotifications(deps(), bob)).map((n) => n.type)).toContain(
        "APPOINTMENT_CANCELLED",
      );
      expect(await db().auditLog.count({ where: { action: "appointment.cancelled" } })).toBe(1);
      await expectCode(respondToAppointment(deps(), bob, id, "ACCEPTED"), "UNPROCESSABLE");
      await expectCode(
        rescheduleAppointment(deps(), alice, id, { startsAt: at(60), durationMinutes: 30 }, NOW),
        "UNPROCESSABLE",
      );
    });
  });

  describe("privacy", () => {
    it("shows meetings only to the organizer and attendees, including admins", async () => {
      const { alice, bob, admin, owner } = await setup();
      await book(alice, at(24), { attendeeIds: [bob.userId] });
      expect(await listAppointments(deps(), alice, {}, NOW)).toHaveLength(1);
      expect(await listAppointments(deps(), bob, {}, NOW)).toHaveLength(1);
      for (const outsider of [admin, owner])
        expect(await listAppointments(deps(), outsider, {}, NOW)).toEqual([]);
      // Notification titles are not resolved for people outside the meeting.
      const [note] = await listNotifications(deps(), bob);
      await db().appointmentAttendee.deleteMany({ where: { userId: bob.userId } });
      const [after] = await listNotifications(deps(), bob);
      expect(note!.resourceTitle).toBe("Planning");
      expect(after!.resourceTitle).toBeNull();
    });

    it("links CRM contacts only the organizer may see, and shows their name only to people who may see them", async () => {
      const { alice, bob, viewer, carol } = await setup();
      const contact = await createContact(deps(), alice, {
        name: "Dana Customer",
        email: "dana@x.test",
      });
      await expectCode(book(bob, at(24), { contactId: contact.id }), "UNPROCESSABLE");
      await expectCode(book(carol, at(24), { contactId: crypto.randomUUID() }), "UNPROCESSABLE");
      await book(alice, at(24), {
        contactId: contact.id,
        attendeeIds: [bob.userId, viewer.userId],
      });
      expect((await listAppointments(deps(), alice, {}, NOW))[0]!.contactName).toBe(
        "Dana Customer",
      );
      // Bob and the viewer attend, but neither may open this contact.
      expect((await listAppointments(deps(), bob, {}, NOW))[0]!.contactName).toBeNull();
      expect((await listAppointments(deps(), viewer, {}, NOW))[0]!.contactName).toBeNull();
    });
  });

  describe("tenant isolation", () => {
    it("never exposes or modifies another organization's meetings", async () => {
      const { alice, globexOwner } = await setup();
      const { id } = await book(globexOwner, at(24));
      expect(await listAppointments(deps(), alice, {}, NOW)).toEqual([]);
      await expectCode(respondToAppointment(deps(), alice, id, "ACCEPTED"), "NOT_FOUND");
      await expectCode(cancelAppointment(deps(), alice, id), "NOT_FOUND");
      await expectCode(
        rescheduleAppointment(deps(), alice, id, { startsAt: at(30), durationMinutes: 30 }, NOW),
        "NOT_FOUND",
      );
      // Booking the same time in another organization is not a conflict.
      await expect(book(alice, at(24))).resolves.toBeDefined();
    });

    it("rejects cross-tenant contacts and attendee rows at the database level", async () => {
      const { alice, globexOwner, acme } = await setup();
      const contact = await createContact(deps(), globexOwner, { name: "Foreign" });
      await expect(
        db().appointment.create({
          data: {
            organizationId: acme.organization.id,
            title: "Cross",
            startsAt: at(2),
            endsAt: at(3),
            organizerId: alice.userId,
            contactId: contact.id,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db().appointment.create({
          data: {
            organizationId: acme.organization.id,
            title: "Bad",
            startsAt: at(3),
            endsAt: at(2),
            organizerId: alice.userId,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
