import "server-only";
import { GOOGLE_FREEBUSY_SCOPE } from "@/features/calendar-sync/schemas/calendar-sync";

/** Google refused the refresh token (revoked, expired or the account is gone): reconnect. */
export class GoogleAccessRevokedError extends Error {
  constructor() {
    super("Google no longer accepts this connection");
    this.name = "GoogleAccessRevokedError";
  }
}

/** Google could not be reached or answered something unusable. Retrying later may work. */
export class GoogleUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleUnavailableError";
  }
}

export type BusyInterval = { startsAt: Date; endsAt: Date };

export type GoogleCalendarGateway = {
  authorizationUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<{
    accessToken: string;
    expiresInSeconds: number;
    refreshToken: string | null;
    scopes: string[];
  }>;
  refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresInSeconds: number }>;
  /** Busy periods of the person's primary calendar in [from, to). */
  queryFreeBusy(accessToken: string, from: Date, to: Date): Promise<BusyInterval[]>;
  /** Best effort: the caller has already forgotten the token either way. */
  revoke(token: string): Promise<void>;
};

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
const TIMEOUT_MS = 8_000;

type Fetch = typeof fetch;

async function call(fetcher: Fetch, url: string, init: RequestInit) {
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new GoogleUnavailableError("Could not reach Google");
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const form = (values: Record<string, string>) => new URLSearchParams(values).toString();
const formHeaders = { "content-type": "application/x-www-form-urlencoded" };

/**
 * Google OAuth and Calendar over plain HTTPS. Nothing here logs or returns a secret except to the
 * caller that asked for it; failures carry no response bodies.
 */
export function createGoogleGateway(config: {
  clientId: string;
  clientSecret: string;
  fetch?: Fetch;
}): GoogleCalendarGateway {
  const fetcher = config.fetch ?? fetch;

  async function tokenRequest(values: Record<string, string>) {
    const response = await call(fetcher, TOKEN_URL, {
      method: "POST",
      headers: formHeaders,
      body: form({ client_id: config.clientId, client_secret: config.clientSecret, ...values }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      if (body.error === "invalid_grant") throw new GoogleAccessRevokedError();
      throw new GoogleUnavailableError(`Google token request failed (${response.status})`);
    }
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new GoogleUnavailableError("Google returned an unusable token response");
    }
    return body as Record<string, unknown> & { access_token: string; expires_in: number };
  }

  return {
    authorizationUrl({ state, redirectUri }) {
      const url = new URL(AUTH_URL);
      url.search = form({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GOOGLE_FREEBUSY_SCOPE,
        // Offline access gives a refresh token; `consent` makes Google issue one on every connect.
        access_type: "offline",
        prompt: "consent",
        state,
      });
      return url.toString();
    },

    async exchangeCode({ code, redirectUri }) {
      const body = await tokenRequest({
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      return {
        accessToken: body.access_token,
        expiresInSeconds: body.expires_in,
        refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
        scopes: typeof body.scope === "string" ? body.scope.split(" ") : [],
      };
    },

    async refreshAccessToken(refreshToken) {
      const body = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
      return { accessToken: body.access_token, expiresInSeconds: body.expires_in };
    },

    async queryFreeBusy(accessToken, from, to) {
      const response = await call(fetcher, FREEBUSY_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          items: [{ id: "primary" }],
        }),
      });
      if (response.status === 401) throw new GoogleAccessRevokedError();
      if (!response.ok) {
        throw new GoogleUnavailableError(`Google free/busy failed (${response.status})`);
      }
      const body = await readJson(response);
      const calendars = body.calendars as Record<string, unknown> | undefined;
      const primary = calendars?.primary as { busy?: unknown; errors?: unknown } | undefined;
      // A calendar that answered with errors is "unknown", never "free".
      if (!primary || !Array.isArray(primary.busy) || primary.errors !== undefined) {
        throw new GoogleUnavailableError("Google did not return the calendar's busy times");
      }
      return primary.busy.map((entry: { start?: unknown; end?: unknown }) => {
        const startsAt = new Date(String(entry.start));
        const endsAt = new Date(String(entry.end));
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
          throw new GoogleUnavailableError("Google returned an invalid busy period");
        }
        return { startsAt, endsAt };
      });
    },

    async revoke(token) {
      await call(fetcher, REVOKE_URL, {
        method: "POST",
        headers: formHeaders,
        body: form({ token }),
      });
    },
  };
}
