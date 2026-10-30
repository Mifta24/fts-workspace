import "server-only";
import { GOOGLE_CALLBACK_PATH } from "@/features/calendar-sync/schemas/calendar-sync";
import {
  createGoogleGateway,
  type GoogleCalendarGateway,
} from "@/features/calendar-sync/server/google-gateway";
import { env } from "@/lib/env";
import { createSecretBox, parseSecretKey, type SecretBox } from "@/server/security/secret-box";

/** Everything the calendar connection needs from the deployment. Tests pass their own. */
export type CalendarSync = {
  gateway: GoogleCalendarGateway;
  box: SecretBox;
  /** Where Google sends the person back; registered with Google exactly as written. */
  redirectUri: string;
};

let cached: CalendarSync | null | undefined;

/** The deployment's Google Calendar setup, or null when it is not configured (feature off). */
export function configuredSync(): CalendarSync | null {
  if (cached !== undefined) return cached;
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALENDAR_TOKEN_KEY, BETTER_AUTH_URL } = env();
  const key = CALENDAR_TOKEN_KEY ? parseSecretKey(CALENDAR_TOKEN_KEY) : undefined;
  cached =
    GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && key
      ? {
          gateway: createGoogleGateway({
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
          }),
          box: createSecretBox(key),
          redirectUri: `${BETTER_AUTH_URL.replace(/\/+$/, "")}${GOOGLE_CALLBACK_PATH}`,
        }
      : null;
  return cached;
}
