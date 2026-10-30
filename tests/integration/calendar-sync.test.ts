import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  bookPublicSlot,
  createBookingPage,
  getBookingPage,
  getPublicBookingPage,
  setBookingPageStatus,
} from "@/features/booking/server/booking-service";
import { GOOGLE_FREEBUSY_SCOPE } from "@/features/calendar-sync/schemas/calendar-sync";
import {
  beginGoogleConnect,
  disconnectGoogle,
  finishGoogleConnect,
  getGoogleConnection,
  googleBusyFor,
} from "@/features/calendar-sync/server/calendar-sync-service";
import {
  GoogleAccessRevokedError,
  GoogleUnavailableError,
  type BusyInterval,
  type GoogleCalendarGateway,
} from "@/features/calendar-sync/server/google-gateway";
import { sealOAuthState } from "@/features/calendar-sync/server/oauth-state";
import type { CalendarSync } from "@/features/calendar-sync/server/sync-config";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createSecretBox } from "@/server/security/secret-box";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const HOUR = 3_600_000;
// Monday 2026-11-02 08:00 UTC.
const NOW = new Date("2026-11-02T08:00:00Z");
const slotAt = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour));
const box = createSecretBox(randomBytes(32));
const REDIRECT = "http://localhost:3000/api/integrations/google/callback";

/** A scriptable Google: tests choose what it answers and read what it was asked. */
function fakeGoogle() {
  const script = {
    busy: [] as BusyInterval[],
    mode: "ok" as "ok" | "revoked" | "down",
    exchange: {
      refreshToken: "1//refresh-one" as string | null,
      scopes: [GOOGLE_FREEBUSY_SCOPE],
      fails: false,
    },
  };
  const calls = { refresh: 0, freeBusy: 0, revoked: [] as string[], exchanged: [] as string[] };
  const gateway: GoogleCalendarGateway = {
    authorizationUrl: ({ state, redirectUri }) =>
      `https://google.test/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    async exchangeCode({ code }) {
      calls.exchanged.push(code);
      if (script.exchange.fails) throw new GoogleUnavailableError("down");
      return {
        accessToken: "access-0",
        expiresInSeconds: 3600,
        refreshToken: script.exchange.refreshToken,
        scopes: script.exchange.scopes,
      };
    },
    async refreshAccessToken() {
      calls.refresh += 1;
      if (script.mode === "revoked") throw new GoogleAccessRevokedError();
      if (script.mode === "down") throw new GoogleUnavailableError("down");
      return { accessToken: `access-${calls.refresh}`, expiresInSeconds: 3600 };
    },
    async queryFreeBusy() {
      calls.freeBusy += 1;
      if (script.mode === "down") throw new GoogleUnavailableError("down");
      return script.busy;
    },
    async revoke(token) {
      calls.revoked.push(token);
    },
  };
  const sync: CalendarSync = { gateway, box, redirectUri: REDIRECT };
  return { script, calls, sync };
}

type Google = ReturnType<typeof fakeGoogle>;
const deps = (google: Google | null) => ({ prisma: db(), sync: google?.sync ?? null });

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization({ prisma: db() }, { userId, organizationSlug: slug });

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

/** Starts the round trip and comes back from Google, as the browser would. */
async function connect(
  google: Google,
  context: OrganizationContext,
  options: { now?: Date; state?: string | null; code?: string | null; error?: string | null } = {},
) {
  const now = options.now ?? NOW;
  const { url, cookie } = beginGoogleConnect(deps(google), context, "en", now);
  return finishGoogleConnect(
    deps(google),
    {
      userId: context.userId,
      cookie: cookie.value,
      state: options.state === undefined ? new URL(url).searchParams.get("state") : options.state,
      code: options.code === undefined ? "code-1" : options.code,
      error: options.error ?? null,
    },
    now,
  );
}

const rows = (organizationId?: string) =>
  db().calendarConnection.findMany({ where: organizationId ? { organizationId } : {} });

async function publishedPage(context: OrganizationContext) {
  const { id } = await createBookingPage(deps(null), context, {
    title: "Intro call",
    durationMinutes: 60,
    timeZone: "UTC",
    weekdays: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "12:00",
    minNoticeHours: 4,
    maxDaysAhead: 7,
    consentText: "I agree that you may store these details and contact me.",
  });
  await setBookingPageStatus(deps(null), context, id, "PUBLISHED");
  return getBookingPage(deps(null), context, id, NOW);
}

const visitor = (startsAt: Date) => ({ startsAt, name: "Visitor", email: "visitor@example.test" });
const times = (slots: Date[]) => slots.map((slot) => slot.getTime());

describe("Google Calendar connection", () => {
  beforeEach(resetDatabase);

  describe("connecting", () => {
    it("starts only for people who may manage booking, and only when it is set up", async () => {
      const { alice, viewer } = await setup();
      const google = fakeGoogle();
      expect(() => beginGoogleConnect(deps(google), viewer, "en")).toThrow(AppError);
      expect(() => beginGoogleConnect(deps(null), alice, "en")).toThrow(AppError);
      const { url, cookie } = beginGoogleConnect(deps(google), alice, "ja", NOW);
      expect(url).toContain("https://google.test/auth?state=");
      expect(cookie.value).not.toContain("acme");
      expect(cookie.maxAgeSeconds).toBe(600);
    });

    it("stores the refresh token sealed, binds it to its owner and audits without the token", async () => {
      const { alice, acme } = await setup();
      const google = fakeGoogle();
      expect(await connect(google, alice)).toEqual({
        result: "connected",
        returnTo: { organizationSlug: "acme", locale: "en" },
      });
      const [row] = await rows();
      expect(row).toMatchObject({
        organizationId: acme.organization.id,
        userId: alice.userId,
        provider: "GOOGLE",
        status: "ACTIVE",
      });
      expect(row!.refreshTokenSealed).not.toContain("refresh-one");
      expect(
        box.open(
          row!.refreshTokenSealed,
          `calendar-connection:GOOGLE:${acme.organization.id}:${alice.userId}`,
        ),
      ).toBe("1//refresh-one");
      const audit = await db().auditLog.findFirstOrThrow({
        where: { action: "calendar_connection.connected" },
      });
      expect(audit).toMatchObject({ actorId: alice.userId, organizationId: acme.organization.id });
      expect(JSON.stringify(audit)).not.toContain("refresh-one");
      expect(await getGoogleConnection(deps(google), alice)).toMatchObject({
        configured: true,
        status: "ACTIVE",
      });
    });

    it("refuses a return that does not match what was started", async () => {
      const { alice, bob } = await setup();
      const google = fakeGoogle();
      const started = beginGoogleConnect(deps(google), alice, "en", NOW);
      const state = new URL(started.url).searchParams.get("state");
      const finish = (overrides: object, now = NOW) =>
        finishGoogleConnect(
          deps(google),
          {
            userId: alice.userId,
            cookie: started.cookie.value,
            state,
            code: "c",
            error: null,
            ...overrides,
          },
          now,
        );

      expect(await finish({ state: "forged-state-value" })).toEqual({ result: "failed" });
      expect(await finish({ state: null })).toEqual({ result: "failed" });
      expect(await finish({ cookie: undefined })).toEqual({ result: "failed" });
      expect(await finish({ cookie: `${started.cookie.value}x` })).toEqual({ result: "failed" });
      expect(await finish({}, new Date(NOW.getTime() + 11 * 60_000))).toEqual({ result: "failed" });
      // Someone else's browser session finishing alice's round trip.
      expect(await finish({ userId: bob.userId })).toEqual({ result: "failed" });
      expect(google.calls.exchanged).toEqual([]);
      expect(await rows()).toEqual([]);
    });

    it("treats a refusal, a missing permission or a missing refresh token as not connected", async () => {
      const { alice } = await setup();
      const google = fakeGoogle();
      expect(await connect(google, alice, { error: "access_denied" })).toMatchObject({
        result: "denied",
      });
      expect(await connect(google, alice, { error: "server_error" })).toMatchObject({
        result: "failed",
      });
      expect(await connect(google, alice, { code: null })).toMatchObject({ result: "failed" });

      google.script.exchange.scopes = []; // they unticked the permission on Google's screen
      expect(await connect(google, alice)).toMatchObject({ result: "denied" });
      google.script.exchange.scopes = [GOOGLE_FREEBUSY_SCOPE];
      google.script.exchange.refreshToken = null;
      expect(await connect(google, alice)).toMatchObject({ result: "failed" });
      google.script.exchange.refreshToken = "1//refresh-one";
      google.script.exchange.fails = true;
      expect(await connect(google, alice)).toMatchObject({ result: "failed" });
      expect(await rows()).toEqual([]);
    });

    it("re-checks the person's rights when they come back, and never crosses organizations", async () => {
      const { alice, acme, globex } = await setup();
      const google = fakeGoogle();
      const attempt = (slug: string, userId: string) =>
        finishGoogleConnect(
          deps(google),
          {
            userId,
            cookie: sealOAuthState(box, {
              state: "s".repeat(32),
              userId,
              organizationSlug: slug,
              locale: "en",
              expiresAt: NOW.getTime() + 60_000,
            }),
            state: "s".repeat(32),
            code: "c",
            error: null,
          },
          NOW,
        );

      // A workspace the person does not belong to.
      expect((await attempt("globex", alice.userId)).result).toBe("failed");
      expect((await attempt("no-such-workspace", alice.userId)).result).toBe("failed");
      // A member who lost the right to manage booking between starting and finishing.
      await db().member.update({
        where: {
          organizationId_userId: { organizationId: acme.organization.id, userId: alice.userId },
        },
        data: { role: "VIEWER" },
      });
      expect((await attempt("acme", alice.userId)).result).toBe("failed");
      // A disabled member.
      await db().member.update({
        where: {
          organizationId_userId: { organizationId: acme.organization.id, userId: alice.userId },
        },
        data: { role: "MEMBER", status: "DISABLED" },
      });
      expect((await attempt("acme", alice.userId)).result).toBe("failed");
      expect(await rows()).toEqual([]);
      expect(await rows(globex.organization.id)).toEqual([]);
      expect(google.calls.exchanged).toEqual([]);
    });

    it("replaces an earlier connection and revokes its token", async () => {
      const { alice } = await setup();
      const google = fakeGoogle();
      await connect(google, alice);
      google.script.exchange.refreshToken = "1//refresh-two";
      await connect(google, alice);
      expect(await rows()).toHaveLength(1);
      expect(google.calls.revoked).toEqual(["1//refresh-one"]);
    });
  });

  describe("status and disconnecting", () => {
    it("shows each person only their own connection and requires the booking right", async () => {
      const { alice, bob, viewer } = await setup();
      const google = fakeGoogle();
      await connect(google, alice);
      expect(await getGoogleConnection(deps(google), bob)).toMatchObject({ status: null });
      expect(await getGoogleConnection(deps(null), bob)).toMatchObject({ configured: false });
      await expectCode(getGoogleConnection(deps(google), viewer), "FORBIDDEN");
      await expectCode(disconnectGoogle(deps(google), viewer), "FORBIDDEN");
    });

    it("removes the connection, withdraws the token at Google, and leaves others alone", async () => {
      const { alice, bob, acme } = await setup();
      const google = fakeGoogle();
      await connect(google, alice);
      google.script.exchange.refreshToken = "1//bob";
      await connect(google, bob);

      await disconnectGoogle(deps(google), alice);
      const left = await rows();
      expect(left.map((row) => row.userId)).toEqual([bob.userId]);
      expect(google.calls.revoked).toEqual(["1//refresh-one"]);
      expect(
        await db().auditLog.count({
          where: {
            action: "calendar_connection.disconnected",
            organizationId: acme.organization.id,
          },
        }),
      ).toBe(1);
      // Nothing to disconnect any more: quietly nothing happens.
      await disconnectGoogle(deps(google), alice);
      expect(google.calls.revoked).toHaveLength(1);
    });

    it("forgets the connection even when Google cannot be told", async () => {
      const { alice } = await setup();
      const google = fakeGoogle();
      await connect(google, alice);
      google.sync.gateway.revoke = async () => {
        throw new GoogleUnavailableError("down");
      };
      await disconnectGoogle(deps(google), alice);
      expect(await rows()).toEqual([]);
    });
  });

  describe("storage rules", () => {
    it("refuses plaintext tokens and connections for people outside the organization", async () => {
      const { alice, acme, globex } = await setup();
      await expect(
        db().calendarConnection.create({
          data: {
            organizationId: acme.organization.id,
            userId: alice.userId,
            provider: "GOOGLE",
            refreshTokenSealed: "1//plain-text-token",
          },
        }),
      ).rejects.toThrow();
      // alice is not a member of globex: the composite foreign key refuses the row.
      await expect(
        db().calendarConnection.create({
          data: {
            organizationId: globex.organization.id,
            userId: alice.userId,
            provider: "GOOGLE",
            refreshTokenSealed: box.seal("t", "x"),
          },
        }),
      ).rejects.toThrow();
    });

    it("drops the connection with the membership", async () => {
      const { alice, acme } = await setup();
      const google = fakeGoogle();
      await connect(google, alice);
      await db().member.delete({
        where: {
          organizationId_userId: { organizationId: acme.organization.id, userId: alice.userId },
        },
      });
      expect(await rows()).toEqual([]);
    });
  });

  describe("on booking pages", () => {
    it("hides the times Google says are busy, and shows them again when they are free", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      const google = fakeGoogle();
      const without = await getPublicBookingPage(deps(google), page.publicToken, NOW);
      expect(times(without.slots)).toContain(slotAt(3, 9).getTime());
      expect(google.calls.freeBusy).toBe(0);

      await connect(google, alice);
      google.script.busy = [{ startsAt: slotAt(3, 9), endsAt: slotAt(3, 10) }];
      const view = await getPublicBookingPage(deps(google), page.publicToken, NOW);
      expect(view.unavailable).toBe(false);
      expect(times(view.slots)).not.toContain(slotAt(3, 9).getTime());
      expect(times(view.slots)).toContain(slotAt(3, 10).getTime());
      expect(times(view.slots)).toEqual(
        times(without.slots).filter((time) => time !== slotAt(3, 9).getTime()),
      );
    });

    it("books with a fresh look, even when the page was viewed a moment ago", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      const google = fakeGoogle();
      await connect(google, alice);
      const seen = await getPublicBookingPage(deps(google), page.publicToken, NOW);
      expect(times(seen.slots)).toContain(slotAt(3, 9).getTime());

      // A meeting appears in Google after the visitor loaded the page.
      google.script.busy = [{ startsAt: slotAt(3, 9), endsAt: slotAt(3, 10) }];
      await expectCode(
        bookPublicSlot(deps(google), page.publicToken, visitor(slotAt(3, 9)), true, NOW),
        "CONFLICT",
      );
      expect(await db().appointment.count()).toBe(0);
      await expect(
        bookPublicSlot(deps(google), page.publicToken, visitor(slotAt(3, 10)), true, NOW),
      ).resolves.toBeDefined();
    });

    it("reuses a lookup for a minute but asks again afterwards", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      const google = fakeGoogle();
      await connect(google, alice);
      await getPublicBookingPage(deps(google), page.publicToken, NOW);
      await getPublicBookingPage(deps(google), page.publicToken, new Date(NOW.getTime() + 30_000));
      expect(google.calls.freeBusy).toBe(1);
      await getPublicBookingPage(deps(google), page.publicToken, new Date(NOW.getTime() + 61_000));
      expect(google.calls.freeBusy).toBe(2);
      // One access token covers all of it.
      expect(google.calls.refresh).toBe(1);
    });

    it("offers nothing, and accepts no booking, while the connection cannot be read", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      const google = fakeGoogle();
      await connect(google, alice);
      google.script.mode = "down";

      const view = await getPublicBookingPage(deps(google), page.publicToken, NOW);
      expect(view).toMatchObject({ unavailable: true, slots: [] });
      await expectCode(
        bookPublicSlot(deps(google), page.publicToken, visitor(slotAt(3, 10)), true, NOW),
        "CONFLICT",
      );
      expect(await db().appointment.count()).toBe(0);
      // An outage is not a revocation: the connection stays, and recovers by itself.
      expect((await rows())[0]!.status).toBe("ACTIVE");
      google.script.mode = "ok";
      const later = new Date(NOW.getTime() + 2 * 60_000);
      expect(
        (await getPublicBookingPage(deps(google), page.publicToken, later)).slots.length,
      ).toBeGreaterThan(0);
    });

    it("marks a connection Google no longer accepts, and closes the page until it is fixed", async () => {
      const { alice, acme } = await setup();
      const page = await publishedPage(alice);
      const google = fakeGoogle();
      await connect(google, alice);
      google.script.mode = "revoked";

      expect(await getPublicBookingPage(deps(google), page.publicToken, NOW)).toMatchObject({
        unavailable: true,
        slots: [],
      });
      expect((await rows())[0]!.status).toBe("NEEDS_RECONNECT");
      expect(await getGoogleConnection(deps(google), alice)).toMatchObject({
        status: "NEEDS_RECONNECT",
      });
      const audit = await db().auditLog.findMany({
        where: {
          action: "calendar_connection.needs_reconnect",
          organizationId: acme.organization.id,
        },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actorId).toBeNull();

      // No further calls to Google while it is marked, however often the page is opened.
      const before = google.calls.refresh;
      await getPublicBookingPage(deps(google), page.publicToken, NOW);
      expect(google.calls.refresh).toBe(before);

      google.script.mode = "ok";
      await connect(google, alice);
      expect((await rows())[0]!.status).toBe("ACTIVE");
      const view = await getPublicBookingPage(deps(google), page.publicToken, NOW);
      expect(view.unavailable).toBe(false);
      expect(view.slots.length).toBeGreaterThan(0);
    });

    it("does not read the calendar when the deployment no longer has Google configured", async () => {
      const { alice } = await setup();
      const page = await publishedPage(alice);
      const google = fakeGoogle();
      await connect(google, alice);
      const view = await getPublicBookingPage(deps(null), page.publicToken, NOW);
      expect(view).toMatchObject({ unavailable: true, slots: [] });
    });

    it("never uses one organization's connection for a page in another", async () => {
      const { alice, acme, globex, globexOwner } = await setup();
      // alice also belongs to globex, where she has a page but has not connected anything.
      await db().member.create({
        data: { organizationId: globex.organization.id, userId: alice.userId, role: "MEMBER" },
      });
      const aliceInGlobex = await contextFor("globex", alice.userId);
      const page = await publishedPage(aliceInGlobex);
      const google = fakeGoogle();
      google.script.busy = [{ startsAt: slotAt(3, 9), endsAt: slotAt(3, 10) }];
      await connect(google, alice); // connected in acme only

      const view = await getPublicBookingPage(deps(google), page.publicToken, NOW);
      expect(times(view.slots)).toContain(slotAt(3, 9).getTime());
      expect(google.calls.freeBusy).toBe(0);
      expect(
        await googleBusyFor(
          deps(google),
          { organizationId: globex.organization.id, userId: alice.userId },
          new Date(NOW.getTime() + 24 * HOUR),
          { now: NOW },
        ),
      ).toEqual({ status: "none" });
      expect((await rows(acme.organization.id)).length).toBe(1);
      expect(await rows(globex.organization.id)).toEqual([]);
      expect(globexOwner.userId).not.toBe(alice.userId);
    });

    it("cannot open a token moved to another person's row", async () => {
      const { alice, bob, acme } = await setup();
      const page = await publishedPage(bob);
      const google = fakeGoogle();
      await connect(google, alice);
      await connect(google, bob);
      const [aliceRow] = await db().calendarConnection.findMany({
        where: { userId: alice.userId },
      });
      await db().calendarConnection.update({
        where: {
          organizationId_userId_provider: {
            organizationId: acme.organization.id,
            userId: bob.userId,
            provider: "GOOGLE",
          },
        },
        data: { refreshTokenSealed: aliceRow!.refreshTokenSealed },
      });
      const before = google.calls.refresh;
      const view = await getPublicBookingPage(deps(google), page.publicToken, NOW);
      expect(view).toMatchObject({ unavailable: true, slots: [] });
      expect(google.calls.refresh).toBe(before);
    });
  });
});
