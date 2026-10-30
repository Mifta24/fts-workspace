import { beforeEach, describe, expect, it } from "vitest";
import { listNotifications } from "@/features/notifications/server/notification-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { REMINDER_JOB } from "@/features/scheduling/schemas/scheduling";
import { sendAppointmentReminder } from "@/features/scheduling/server/reminders";
import {
  cancelAppointment,
  createAppointment,
  getTimeZone,
  rescheduleAppointment,
  resolveLocalStart,
  respondToAppointment,
  setTimeZone,
} from "@/features/scheduling/server/scheduling-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { runJobs } from "@/server/jobs/queue";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
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
    alice: "MEMBER",
    bob: "MEMBER",
    carol: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    alice: await contextFor("acme", acme.users.alice!.id),
    bob: await contextFor("acme", acme.users.bob!.id),
    carol: await contextFor("acme", acme.users.carol!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

const book = (
  context: OrganizationContext,
  startsAt: Date,
  overrides: Record<string, unknown> = {},
) =>
  createAppointment(
    deps(),
    context,
    { title: "Planning", startsAt, durationMinutes: 60, attendeeIds: [], ...overrides },
    NOW,
  );

/** Runs due reminder jobs as the worker would, at the given time. */
const deliver = (now: Date) =>
  runJobs(
    db(),
    { [REMINDER_JOB]: (job) => sendAppointmentReminder({ prisma: db() }, job, now) },
    { now: () => now },
  );

const reminders = async (context: OrganizationContext) =>
  (await listNotifications(deps(), context)).filter((n) => n.type === "APPOINTMENT_REMINDER");

describe("meeting reminders", () => {
  beforeEach(resetDatabase);

  it("queues one reminder job at the chosen lead time, and none when switched off", async () => {
    const { alice } = await setup();
    const { id } = await book(alice, at(24), { reminderMinutes: 30 });
    const job = await db().job.findFirstOrThrow({ where: { type: REMINDER_JOB } });
    expect(job.runAt.toISOString()).toBe(new Date(at(24).getTime() - 30 * MINUTE).toISOString());
    expect(job.payload).toEqual({ appointmentId: id, startsAt: at(24).toISOString() });

    await book(alice, at(48), { reminderMinutes: 0 });
    expect(await db().job.count({ where: { type: REMINDER_JOB } })).toBe(1);

    // The default is 15 minutes before.
    const defaulted = await book(alice, at(72));
    expect(
      (await db().appointment.findUniqueOrThrow({ where: { id: defaulted.id } })).reminderMinutes,
    ).toBe(15);
  });

  it("rejects lead times that are not offered", async () => {
    const { alice } = await setup();
    await expectCode(book(alice, at(2), { reminderMinutes: 7 }), "INVALID_INPUT");
    await expectCode(book(alice, at(2), { reminderMinutes: -1 }), "INVALID_INPUT");
    await expect(
      db().appointment.create({
        data: {
          organizationId: (await db().organization.findFirstOrThrow({ where: { slug: "acme" } }))
            .id,
          title: "Bad",
          startsAt: at(2),
          endsAt: at(3),
          organizerId: alice.userId,
          reminderMinutes: 99999,
        },
      }),
    ).rejects.toThrow();
  });

  it("reminds everyone who has not declined once the time has come, and only then", async () => {
    const { alice, bob, carol } = await setup();
    const { id } = await book(alice, at(24), { attendeeIds: [bob.userId, carol.userId] });
    await respondToAppointment(deps(), carol, id, "DECLINED");

    expect((await deliver(at(23))).done).toBe(0); // not due yet
    expect(await reminders(bob)).toEqual([]);

    const dueAt = new Date(at(24).getTime() - 15 * MINUTE);
    expect(await deliver(dueAt)).toEqual({ done: 1, retried: 0, failed: 0 });
    for (const person of [alice, bob]) {
      const [note] = await reminders(person);
      expect(note).toMatchObject({ resourceTitle: "Planning", actorName: null });
    }
    expect(await reminders(carol)).toEqual([]);
  });

  it("does not send a second reminder when the job runs again", async () => {
    const { alice, bob } = await setup();
    const { id } = await book(alice, at(24), { attendeeIds: [bob.userId] });
    const dueAt = new Date(at(24).getTime() - 15 * MINUTE);
    await deliver(dueAt);
    const job = await db().job.findFirstOrThrow({ where: { type: REMINDER_JOB } });
    await sendAppointmentReminder({ prisma: db() }, { ...job, attempts: 2, maxAttempts: 3 }, dueAt);
    expect(await reminders(bob)).toHaveLength(1);
    expect(await db().notification.count({ where: { resourceId: id } })).toBe(3); // invite + 2 reminders
  });

  it("sends the reminder right away when the meeting is closer than the lead time", async () => {
    const { alice } = await setup();
    await book(alice, new Date(NOW.getTime() + 5 * MINUTE));
    const job = await db().job.findFirstOrThrow({ where: { type: REMINDER_JOB } });
    expect(job.runAt.getTime()).toBe(NOW.getTime());
    await deliver(NOW);
    expect(await reminders(alice)).toHaveLength(1);
  });

  it("follows a rescheduled meeting and retires the reminder for the old time", async () => {
    const { alice, bob } = await setup();
    const { id } = await book(alice, at(24), { attendeeIds: [bob.userId] });
    const firstDue = new Date(at(24).getTime() - 15 * MINUTE);
    await deliver(firstDue);
    expect(await reminders(bob)).toHaveLength(1);

    await rescheduleAppointment(
      deps(),
      alice,
      id,
      { startsAt: at(48), durationMinutes: 60 },
      firstDue,
    );
    // The unread reminder for the old time is no longer worth showing as unread.
    expect((await reminders(bob))[0]!.read).toBe(true);

    expect(await deliver(new Date(at(48).getTime() - 15 * MINUTE))).toEqual({
      done: 1,
      retried: 0,
      failed: 0,
    });
    const fresh = await reminders(bob);
    expect(fresh).toHaveLength(2);
    expect(fresh.filter((n) => !n.read)).toHaveLength(1);
  });

  it("ignores a job queued for a time the meeting has moved away from", async () => {
    const { alice, bob } = await setup();
    const { id } = await book(alice, at(24), { attendeeIds: [bob.userId] });
    await rescheduleAppointment(deps(), alice, id, { startsAt: at(48), durationMinutes: 60 }, NOW);
    // Both the old and the new job exist; only the one matching the current start sends.
    expect(await db().job.count({ where: { type: REMINDER_JOB } })).toBe(2);
    await deliver(new Date(at(24).getTime() - 15 * MINUTE));
    expect(await reminders(bob)).toEqual([]);
  });

  it("sends nothing for cancelled or already started meetings", async () => {
    const { alice, bob } = await setup();
    const cancelled = await book(alice, at(24), { attendeeIds: [bob.userId] });
    await cancelAppointment(deps(), alice, cancelled.id, NOW);
    await book(alice, at(26), { attendeeIds: [bob.userId] });

    await deliver(at(24)); // the first meeting would have started; the second is long past its lead time
    const lateRun = at(27);
    await deliver(lateRun);
    expect(await reminders(bob)).toEqual([]);
    expect(await reminders(alice)).toEqual([]);
  });

  it("does not remind people who left the organization", async () => {
    const { alice, bob, acme } = await setup();
    await book(alice, at(24), { attendeeIds: [bob.userId] });
    await db().member.update({
      where: {
        organizationId_userId: { organizationId: acme.organization.id, userId: bob.userId },
      },
      data: { status: "DISABLED" },
    });
    await deliver(new Date(at(24).getTime() - 15 * MINUTE));
    expect(
      await db().notification.count({
        where: { userId: bob.userId, type: "APPOINTMENT_REMINDER" },
      }),
    ).toBe(0);
  });

  it("never uses a job from one organization to reach a meeting in another", async () => {
    const { acme, alice, bob, globexOwner } = await setup();
    const foreign = await book(globexOwner, at(24));
    await db().job.create({
      data: {
        organizationId: acme.organization.id,
        type: REMINDER_JOB,
        payload: { appointmentId: foreign.id, startsAt: at(24).toISOString() },
      },
    });
    expect(await deliver(new Date(at(24).getTime() - 15 * MINUTE))).toMatchObject({ failed: 0 });
    expect(await reminders(alice)).toEqual([]);
    expect(await reminders(bob)).toEqual([]);
    expect(
      await db().notification.count({
        where: { type: "APPOINTMENT_REMINDER", organizationId: acme.organization.id },
      }),
    ).toBe(0);
  });

  it("fails permanently on a malformed payload instead of looping", async () => {
    const { acme } = await setup();
    await db().job.create({
      data: {
        organizationId: acme.organization.id,
        type: REMINDER_JOB,
        payload: { nope: true },
        maxAttempts: 1,
      },
    });
    expect(await deliver(NOW)).toEqual({ done: 0, retried: 0, failed: 1 });
  });
});

describe("time zones", () => {
  beforeEach(resetDatabase);

  it("defaults to UTC and changes only the caller's own zone", async () => {
    const { alice, bob } = await setup();
    expect(await getTimeZone(deps(), alice)).toBe("UTC");
    await setTimeZone(deps(), alice, "Asia/Tokyo");
    expect(await getTimeZone(deps(), alice)).toBe("Asia/Tokyo");
    expect(await getTimeZone(deps(), bob)).toBe("UTC");
  });

  it("rejects names that are not time zones", async () => {
    const { alice, viewer } = await setup();
    await expectCode(setTimeZone(deps(), alice, "Mars/Olympus"), "INVALID_INPUT");
    await expectCode(setTimeZone(deps(), alice, ""), "INVALID_INPUT");
    await expectCode(setTimeZone(deps(), alice, undefined), "INVALID_INPUT");
    expect(await getTimeZone(deps(), alice)).toBe("UTC");
    // Viewers can read the schedule, so they may choose how times are shown to them.
    await expect(setTimeZone(deps(), viewer, "Asia/Jakarta")).resolves.toBeUndefined();
  });

  it("reads typed times in the caller's zone", async () => {
    const { alice, bob } = await setup();
    await setTimeZone(deps(), alice, "Asia/Tokyo");
    expect((await resolveLocalStart(deps(), alice, "2026-11-03T09:00")).toISOString()).toBe(
      "2026-11-03T00:00:00.000Z",
    );
    expect((await resolveLocalStart(deps(), bob, "2026-11-03T09:00")).toISOString()).toBe(
      "2026-11-03T09:00:00.000Z",
    );
    await expectCode(resolveLocalStart(deps(), alice, ""), "INVALID_INPUT");
    await expectCode(resolveLocalStart(deps(), alice, "2026-11-03 09:00"), "INVALID_INPUT");
  });
});
