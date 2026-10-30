import { describe, expect, it, vi } from "vitest";
import { GOOGLE_FREEBUSY_SCOPE } from "@/features/calendar-sync/schemas/calendar-sync";
import {
  createGoogleGateway,
  GoogleAccessRevokedError,
  GoogleUnavailableError,
} from "@/features/calendar-sync/server/google-gateway";

type Call = { url: string; init: RequestInit };

/** A gateway wired to a fake `fetch` that answers with the queued responses, in order. */
function setup(...responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return {
    calls,
    gateway: createGoogleGateway({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetcher,
    }),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bodyOf = (call: Call) => new URLSearchParams(String(call.init.body));

describe("Google gateway", () => {
  it("asks only for the free/busy permission, offline, with consent and our state", () => {
    const { gateway } = setup();
    const url = new URL(
      gateway.authorizationUrl({ state: "st4te", redirectUri: "http://x.test/cb" }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: "http://x.test/cb",
      response_type: "code",
      scope: GOOGLE_FREEBUSY_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state: "st4te",
    });
  });

  it("exchanges a code for tokens and reports the granted scopes", async () => {
    const { gateway, calls } = setup(
      json({
        access_token: "at",
        expires_in: 3599,
        refresh_token: "rt",
        scope: `${GOOGLE_FREEBUSY_SCOPE} other`,
      }),
    );
    await expect(
      gateway.exchangeCode({ code: "the-code", redirectUri: "http://x.test/cb" }),
    ).resolves.toEqual({
      accessToken: "at",
      expiresInSeconds: 3599,
      refreshToken: "rt",
      scopes: [GOOGLE_FREEBUSY_SCOPE, "other"],
    });
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]!.init.method).toBe("POST");
    expect(Object.fromEntries(bodyOf(calls[0]!))).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "the-code",
      redirect_uri: "http://x.test/cb",
      grant_type: "authorization_code",
    });
  });

  it("reports a missing refresh token as null", async () => {
    const { gateway } = setup(json({ access_token: "at", expires_in: 10, scope: "" }));
    const result = await gateway.exchangeCode({ code: "c", redirectUri: "http://x.test/cb" });
    expect(result).toMatchObject({ refreshToken: null, scopes: [""] });
  });

  it("renews an access token from a refresh token", async () => {
    const { gateway, calls } = setup(json({ access_token: "fresh", expires_in: 3600 }));
    await expect(gateway.refreshAccessToken("rt")).resolves.toEqual({
      accessToken: "fresh",
      expiresInSeconds: 3600,
    });
    expect(Object.fromEntries(bodyOf(calls[0]!))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "rt",
    });
  });

  it("tells a revoked connection from an outage", async () => {
    const revoked = setup(json({ error: "invalid_grant" }, 400));
    await expect(revoked.gateway.refreshAccessToken("rt")).rejects.toBeInstanceOf(
      GoogleAccessRevokedError,
    );
    const down = setup(
      json({ error: "backend_error" }, 503),
      new TypeError("fetch failed"),
      json({ nope: 1 }),
    );
    for (let i = 0; i < 3; i += 1) {
      await expect(down.gateway.refreshAccessToken("rt")).rejects.toBeInstanceOf(
        GoogleUnavailableError,
      );
    }
  });

  it("reads busy periods of the primary calendar and sends no more than it must", async () => {
    const { gateway, calls } = setup(
      json({
        calendars: {
          primary: {
            busy: [
              { start: "2026-11-03T09:00:00Z", end: "2026-11-03T10:00:00Z" },
              { start: "2026-11-04T00:00:00+09:00", end: "2026-11-04T01:00:00+09:00" },
            ],
          },
        },
      }),
    );
    const from = new Date("2026-11-02T08:00:00Z");
    const to = new Date("2026-11-09T08:00:00Z");
    const busy = await gateway.queryFreeBusy("access", from, to);
    expect(busy).toEqual([
      { startsAt: new Date("2026-11-03T09:00:00Z"), endsAt: new Date("2026-11-03T10:00:00Z") },
      { startsAt: new Date("2026-11-03T15:00:00Z"), endsAt: new Date("2026-11-03T16:00:00Z") },
    ]);
    expect(calls[0]!.url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer access");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: "primary" }],
    });
  });

  it("never reads an answer it cannot trust as 'free'", async () => {
    const cases: Array<Response | Error> = [
      json({
        calendars: { primary: { busy: [], errors: [{ domain: "global", reason: "notFound" }] } },
      }),
      json({ calendars: {} }),
      json({}),
      json({
        calendars: { primary: { busy: [{ start: "nonsense", end: "2026-11-03T10:00:00Z" }] } },
      }),
      json({ error: { code: 500 } }, 500),
      new Error("timeout"),
    ];
    for (const answer of cases) {
      const { gateway } = setup(answer);
      await expect(gateway.queryFreeBusy("a", new Date(), new Date())).rejects.toBeInstanceOf(
        GoogleUnavailableError,
      );
    }
    const unauthorised = setup(json({}, 401));
    await expect(
      unauthorised.gateway.queryFreeBusy("a", new Date(), new Date()),
    ).rejects.toBeInstanceOf(GoogleAccessRevokedError);
  });

  it("revokes a token with a form POST", async () => {
    const { gateway, calls } = setup(new Response(null, { status: 200 }));
    await gateway.revoke("rt");
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/revoke");
    expect(bodyOf(calls[0]!).get("token")).toBe("rt");
  });
});
