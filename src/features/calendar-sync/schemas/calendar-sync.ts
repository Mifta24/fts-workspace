/** The only permission asked of Google: when the person is busy, never what the events are. */
export const GOOGLE_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";

/** Path of the OAuth callback, appended to BETTER_AUTH_URL; register it with Google exactly. */
export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";

export const OAUTH_STATE_COOKIE = "fts_google_oauth";
/** How long a person has to finish the consent screen. */
export const OAUTH_STATE_TTL_SECONDS = 600;

/** Shown on the booking settings page after returning from Google (`?calendar=`). */
export const CONNECT_RESULTS = ["connected", "denied", "failed"] as const;
export type ConnectResult = (typeof CONNECT_RESULTS)[number];
