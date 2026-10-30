import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/calendar/[token]/route";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import {
  createFeed,
  getFeedStatus,
  readFeed,
  revokeFeed,
} from "@/features/scheduling/server/calendar-feed";
import {
  cancelAppointment,
  createAppointment,
  respondToAppointment,
} from "@/features/scheduling/server/scheduling-service";
import { db } from "@/lib/db";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = new Date("2026-11-02T08:00:00Z");
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });

async function setup() {
  const acme = await createTestOrganization("acme", {
    alice: "MEMBER",
    bob: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    globex,
    alice: await contextFor("acme", acme.users.alice!.id),
    bob: await contextFor("acme", acme.users.bob!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

const book = (
  context: OrganizationContext,
  title: string,
  startsAt: Date,
  attendeeIds: string[] = [],
  now = NOW,
) =>
  createAppointment(
    deps(),
    context,
    {
      title,
      startsAt,
      durationMinutes: 60,
      attendeeIds,
      location: "Room 4",
      description: "Agenda, items",
    },
    now,
  );

const titles = (calendar: string) => [...calendar.matchAll(/^SUMMARY:(.*)$/gm)].map((m) => m[1]);

describe("calendar feed", () => {
  beforeEach(resetDatabase);

  it("creates a secret link, keeps only its hash and shows the status", async () => {
    const { alice, acme } = await setup();
    expect(await getFeedStatus(deps(), alice)).toEqual({
      enabled: false,
      createdAt: null,
      lastUsedAt: null,
    });
    const { token } = await createFeed(deps(), alice, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await db().calendarFeed.findFirstOrThrow();
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row).toMatchObject({ organizationId: acme.organization.id, userId: alice.userId });
    expect(await getFeedStatus(deps(), alice)).toMatchObject({ enabled: true, createdAt: NOW });
    const audit = await db().auditLog.findFirstOrThrow({
      where: { action: "calendar_feed.created" },
    });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("lists only the owner's live meetings, with every field escaped", async () => {
    const { alice, bob } = await setup();
    const { token } = await createFeed(deps(), alice, NOW);
    await book(alice, "Mine, with comma", inDays(1));
    await book(bob, "Invited", inDays(2), [alice.userId]);
    const declined = await book(bob, "Declined one", inDays(3), [alice.userId]);
    await respondToAppointment(deps(), alice, declined.id, "DECLINED");
    const cancelled = await book(alice, "Cancelled one", inDays(4));
    await cancelAppointment(deps(), alice, cancelled.id, NOW);
    await book(bob, "Someone else's", inDays(5));
    await book(alice, "Too far ahead", inDays(400), [], inDays(380));
    await book(alice, "Long gone", inDays(-20), [], inDays(-30));

    const calendar = (await readFeed(deps(), token, NOW))!;
    expect(titles(calendar)).toEqual(["Mine\\, with comma", "Invited"]);
    expect(calendar).toContain("LOCATION:Room 4");
    expect(calendar).toContain("DESCRIPTION:Agenda\\, items");
    expect(calendar).toContain("STATUS:CONFIRMED"); // organizer
    expect(calendar).toContain("STATUS:TENTATIVE"); // not yet answered
    expect(calendar).toContain("TRIGGER:-PT15M");
    // Names and addresses of other people are never part of the feed.
    expect(calendar).not.toMatch(/Test acme|@example\.test|ATTENDEE|ORGANIZER/);
  });

  it("keeps recent meetings for a week and drops them after that", async () => {
    const { alice } = await setup();
    const { token } = await createFeed(deps(), alice, NOW);
    await book(alice, "Yesterday", inDays(-1), [], inDays(-2));
    await book(alice, "Ten days ago", inDays(-10), [], inDays(-11));
    expect(titles((await readFeed(deps(), token, NOW))!)).toEqual(["Yesterday"]);
  });

  it("answers the same for unknown, malformed, replaced and revoked links", async () => {
    const { alice } = await setup();
    const first = (await createFeed(deps(), alice, NOW)).token;
    expect(await readFeed(deps(), first, NOW)).not.toBeNull();

    const second = (await createFeed(deps(), alice, NOW)).token;
    expect(second).not.toBe(first);
    expect(await readFeed(deps(), first, NOW)).toBeNull();
    expect(await db().calendarFeed.count()).toBe(1);
    expect(await readFeed(deps(), second, NOW)).not.toBeNull();

    for (const bad of [
      "",
      "short",
      "x".repeat(43),
      "!".repeat(43),
      `${second}a`,
      second.slice(1),
    ]) {
      expect(await readFeed(deps(), bad, NOW)).toBeNull();
    }

    await revokeFeed(deps(), alice);
    await revokeFeed(deps(), alice); // idempotent
    expect(await readFeed(deps(), second, NOW)).toBeNull();
    expect(await getFeedStatus(deps(), alice)).toMatchObject({ enabled: false });
    expect(await db().auditLog.count({ where: { action: "calendar_feed.revoked" } })).toBe(1);
  });

  it("stops working when the person leaves the organization", async () => {
    const { alice, acme } = await setup();
    const { token } = await createFeed(deps(), alice, NOW);
    await db().member.update({
      where: {
        organizationId_userId: { organizationId: acme.organization.id, userId: alice.userId },
      },
      data: { status: "DISABLED" },
    });
    expect(await readFeed(deps(), token, NOW)).toBeNull();
  });

  it("is limited to one organization even for a person who belongs to two", async () => {
    const { alice, globexOwner, acme, globex } = await setup();
    await db().member.create({
      data: { organizationId: globex.organization.id, userId: alice.userId, role: "MEMBER" },
    });
    const inGlobex = await contextFor("globex", alice.userId);
    await book(alice, "Acme meeting", inDays(1));
    await book(inGlobex, "Globex meeting", inDays(2));
    await book(globexOwner, "Not Alice's", inDays(3));
    const { token } = await createFeed(deps(), alice, NOW);
    expect(titles((await readFeed(deps(), token, NOW))!)).toEqual(["Acme meeting"]);
    expect(await db().calendarFeed.findFirstOrThrow()).toMatchObject({
      organizationId: acme.organization.id,
    });
    // Each organization has its own link and the two do not interfere.
    const other = (await createFeed(deps(), inGlobex, NOW)).token;
    expect(titles((await readFeed(deps(), other, NOW))!)).toEqual(["Globex meeting"]);
    expect(await readFeed(deps(), token, NOW)).not.toBeNull();
  });

  it("lets every role subscribe, but only to their own meetings", async () => {
    const { viewer, bob } = await setup();
    await book(bob, "Team sync", inDays(1), [viewer.userId]);
    const { token } = await createFeed(deps(), viewer, NOW);
    expect(titles((await readFeed(deps(), token, NOW))!)).toEqual(["Team sync"]);
  });

  it("records use at most once an hour", async () => {
    const { alice } = await setup();
    const { token } = await createFeed(deps(), alice, NOW);
    await readFeed(deps(), token, NOW);
    expect((await db().calendarFeed.findFirstOrThrow()).lastUsedAt).toEqual(NOW);
    await readFeed(deps(), token, new Date(NOW.getTime() + 10 * 60_000));
    expect((await db().calendarFeed.findFirstOrThrow()).lastUsedAt).toEqual(NOW);
    const later = new Date(NOW.getTime() + 2 * HOUR);
    await readFeed(deps(), token, later);
    expect((await db().calendarFeed.findFirstOrThrow()).lastUsedAt).toEqual(later);
  });

  it("rejects anything but a SHA-256 digest in the database", async () => {
    const { alice, acme } = await setup();
    await expect(
      db().calendarFeed.create({
        data: {
          organizationId: acme.organization.id,
          userId: alice.userId,
          tokenHash: "plain-token",
        },
      }),
    ).rejects.toThrow();
  });

  describe("http route", () => {
    const call = (token: string) =>
      GET(new Request(`http://localhost/api/calendar/${token}`), {
        params: Promise.resolve({ token }),
      });

    it("serves the calendar without a session, with private caching headers", async () => {
      const { alice } = await setup();
      await book(alice, "Mine", inDays(1));
      const { token } = await createFeed(deps(), alice);
      for (const path of [token, `${token}.ics`]) {
        const response = await call(path);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(await response.text()).toContain("SUMMARY:Mine");
      }
    });

    it("gives unknown and revoked links the same empty 404", async () => {
      const { alice } = await setup();
      const { token } = await createFeed(deps(), alice);
      await revokeFeed(deps(), alice);
      for (const path of [token, `${token}.ics`, "nope", `${"A".repeat(43)}.ics`]) {
        const response = await call(path);
        expect(response.status).toBe(404);
        expect(await response.text()).toBe("");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
      }
    });
  });
});
