import { NextResponse, type NextRequest } from "next/server";
import {
  GOOGLE_CALLBACK_PATH,
  OAUTH_STATE_COOKIE,
} from "@/features/calendar-sync/schemas/calendar-sync";
import { finishGoogleConnect } from "@/features/calendar-sync/server/calendar-sync-service";
import { routing } from "@/i18n/routing";
import { getSessionUser } from "@/lib/auth/session";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Where Google sends the person back after the consent screen. Authority comes from the signed-in
 * session and the sealed cookie set when they started, never from the query string; the query
 * only carries the one-time code and the `state` that must match that cookie.
 */
export async function GET(request: NextRequest) {
  const correlationId = await getCorrelationId();
  const query = request.nextUrl.searchParams;
  let outcome: Awaited<ReturnType<typeof finishGoogleConnect>> = { result: "failed" };
  try {
    const user = await getSessionUser();
    if (user?.emailVerified) {
      outcome = await finishGoogleConnect(
        { prisma: db(), correlationId },
        {
          userId: user.id,
          cookie: request.cookies.get(OAUTH_STATE_COOKIE)?.value,
          state: query.get("state"),
          code: query.get("code"),
          error: query.get("error"),
        },
      );
    }
  } catch (error) {
    logger.error({ err: error, correlationId }, "google callback failed");
  }

  const locale = routing.locales.find((value) => value === outcome.returnTo?.locale);
  const path = outcome.returnTo
    ? `/${locale ?? routing.defaultLocale}/w/${encodeURIComponent(outcome.returnTo.organizationSlug)}/booking?calendar=${outcome.result}`
    : `/${routing.defaultLocale}/workspaces`;
  const response = NextResponse.redirect(new URL(path, env().BETTER_AUTH_URL));
  // The cookie is single use, whatever the outcome.
  response.cookies.set(OAUTH_STATE_COOKIE, "", { path: GOOGLE_CALLBACK_PATH, maxAge: 0 });
  response.headers.set("cache-control", "private, no-store");
  return response;
}
