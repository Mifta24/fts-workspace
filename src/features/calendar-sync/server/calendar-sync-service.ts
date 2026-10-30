import "server-only";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  GOOGLE_FREEBUSY_SCOPE,
  OAUTH_STATE_TTL_SECONDS,
  type ConnectResult,
} from "@/features/calendar-sync/schemas/calendar-sync";
import {
  GoogleAccessRevokedError,
  type BusyInterval,
} from "@/features/calendar-sync/server/google-gateway";
import {
  openOAuthState,
  sameState,
  sealOAuthState,
} from "@/features/calendar-sync/server/oauth-state";
import { configuredSync, type CalendarSync } from "@/features/calendar-sync/server/sync-config";
import {
  getAuthorizedOrganization,
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/server/services/audit";

/**
 * Reads when a member is busy from their Google Calendar, only to keep booking pages from
 * offering times that clash. Nothing from the calendar is stored: busy periods live in this
 * process for a minute at most, and the refresh token is kept sealed in the database.
 */
type Deps = { prisma: PrismaClient; correlationId?: string; sync?: CalendarSync | null };

const PROVIDER = "GOOGLE" as const;
const PERMISSION = "booking:manage" as const;
/**
 * How long one busy lookup is reused for visitors viewing a page. Bookings never use it. The
 * lookup's horizon moves with the clock, so a lookup also covers a horizon this much later.
 */
const BUSY_CACHE_MS = 60_000;
/** An access token is renewed this long before Google would reject it. */
const TOKEN_SLACK_MS = 60_000;
const CACHE_LIMIT = 200;

const syncOf = (deps: Deps) => (deps.sync === undefined ? configuredSync() : deps.sync);
/** Binds a sealed token to its owner, so it cannot be moved to another row and still open. */
const sealContext = (organizationId: string, userId: string) =>
  `calendar-connection:${PROVIDER}:${organizationId}:${userId}`;
const uniqueKey = (organizationId: string, userId: string) => ({
  organizationId_userId_provider: { organizationId, userId, provider: PROVIDER },
});

/* --------------------------- short-lived, in-memory --------------------------- */

const accessTokens = new Map<string, { token: string; expiresAt: number }>();
const busyLookups = new Map<string, { fetchedAt: number; to: number; busy: BusyInterval[] }>();

function remember<T>(cache: Map<string, T>, key: string, value: T) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
}

const forget = (connectionId: string) => {
  accessTokens.delete(connectionId);
  busyLookups.delete(connectionId);
};

/* --------------------------------- status ---------------------------------- */

export type GoogleConnectionView = {
  /** The deployment has Google credentials; without them there is nothing to connect. */
  configured: boolean;
  status: "ACTIVE" | "NEEDS_RECONNECT" | null;
  connectedAt: Date | null;
};

export async function getGoogleConnection(
  deps: Deps,
  context: OrganizationContext,
): Promise<GoogleConnectionView> {
  requirePermission(context, PERMISSION);
  const row = await deps.prisma.calendarConnection.findUnique({
    where: uniqueKey(context.organization.id, context.userId),
    select: { status: true, connectedAt: true },
  });
  return {
    configured: syncOf(deps) !== null,
    status: row?.status ?? null,
    connectedAt: row?.connectedAt ?? null,
  };
}

/* --------------------------------- connect --------------------------------- */

/** Where to send the person, and the sealed cookie value that must come back with them. */
export function beginGoogleConnect(
  deps: Deps,
  context: OrganizationContext,
  locale: string,
  now: Date = new Date(),
): { url: string; cookie: { value: string; maxAgeSeconds: number } } {
  requirePermission(context, PERMISSION);
  const sync = syncOf(deps);
  if (!sync) throw new AppError("UNPROCESSABLE", "Google Calendar is not set up here.");
  const state = randomBytes(24).toString("base64url");
  return {
    url: sync.gateway.authorizationUrl({ state, redirectUri: sync.redirectUri }),
    cookie: {
      value: sealOAuthState(sync.box, {
        state,
        userId: context.userId,
        organizationSlug: context.organization.slug,
        locale,
        expiresAt: now.getTime() + OAUTH_STATE_TTL_SECONDS * 1000,
      }),
      maxAgeSeconds: OAUTH_STATE_TTL_SECONDS,
    },
  };
}

export type ConnectOutcome = {
  result: ConnectResult;
  /** Where to send the person back; absent when the request cannot be trusted at all. */
  returnTo?: { organizationSlug: string; locale: string };
};

/**
 * Finishes the round trip. The cookie must be ours and unexpired, `state` must match it, the
 * signed-in person must be the one who started it, and they must still be allowed to manage
 * booking in that workspace; only then is the code exchanged and the connection stored.
 */
export async function finishGoogleConnect(
  deps: Deps,
  input: {
    userId: string;
    cookie: string | undefined;
    state: string | null;
    code: string | null;
    error: string | null;
  },
  now: Date = new Date(),
): Promise<ConnectOutcome> {
  const sync = syncOf(deps);
  if (!sync) return { result: "failed" };
  const saved = openOAuthState(sync.box, input.cookie, now);
  if (!saved || !input.state || !sameState(input.state, saved.state)) return { result: "failed" };
  if (saved.userId !== input.userId) return { result: "failed" };
  const returnTo = { organizationSlug: saved.organizationSlug, locale: saved.locale };
  const outcome = (result: ConnectResult): ConnectOutcome => ({ result, returnTo });

  if (input.error) return outcome(input.error === "access_denied" ? "denied" : "failed");
  if (!input.code) return outcome("failed");

  let context: OrganizationContext;
  try {
    context = await getAuthorizedOrganization(deps, {
      userId: input.userId,
      organizationSlug: saved.organizationSlug,
      permission: PERMISSION,
    });
  } catch {
    return outcome("failed");
  }

  let tokens;
  try {
    tokens = await sync.gateway.exchangeCode({ code: input.code, redirectUri: sync.redirectUri });
  } catch (error) {
    logger.warn({ err: error, correlationId: deps.correlationId }, "google code exchange failed");
    return outcome("failed");
  }
  // People can untick individual permissions on Google's screen: without ours it is a refusal.
  if (!tokens.scopes.includes(GOOGLE_FREEBUSY_SCOPE)) return outcome("denied");
  if (!tokens.refreshToken) return outcome("failed");

  const organizationId = context.organization.id;
  const sealed = sync.box.seal(tokens.refreshToken, sealContext(organizationId, input.userId));
  const previous = await deps.prisma.calendarConnection.findUnique({
    where: uniqueKey(organizationId, input.userId),
  });
  const connection = await deps.prisma.$transaction(async (tx) => {
    const row = await tx.calendarConnection.upsert({
      where: uniqueKey(organizationId, input.userId),
      create: {
        organizationId,
        userId: input.userId,
        provider: PROVIDER,
        refreshTokenSealed: sealed,
        connectedAt: now,
      },
      update: { refreshTokenSealed: sealed, status: "ACTIVE", connectedAt: now },
      select: { id: true },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: input.userId,
      action: "calendar_connection.connected",
      resourceType: "calendar_connection",
      resourceId: row.id,
      metadata: { provider: PROVIDER },
      correlationId: deps.correlationId,
    });
    return row;
  });
  forget(connection.id);
  if (previous) await revokeSealed(sync, previous.refreshTokenSealed, organizationId, input.userId);
  // The access token from this exchange is not kept: the next lookup asks for its own.
  return outcome("connected");
}

/* ------------------------------- disconnect -------------------------------- */

export async function disconnectGoogle(deps: Deps, context: OrganizationContext): Promise<void> {
  requirePermission(context, PERMISSION);
  const organizationId = context.organization.id;
  const row = await deps.prisma.$transaction(async (tx) => {
    const existing = await tx.calendarConnection.findUnique({
      where: uniqueKey(organizationId, context.userId),
    });
    if (!existing) return null;
    await tx.calendarConnection.delete({ where: { id: existing.id } });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: "calendar_connection.disconnected",
      resourceType: "calendar_connection",
      resourceId: existing.id,
      metadata: { provider: PROVIDER },
      correlationId: deps.correlationId,
    });
    return existing;
  });
  if (!row) return;
  forget(row.id);
  const sync = syncOf(deps);
  if (sync) await revokeSealed(sync, row.refreshTokenSealed, organizationId, context.userId);
}

/** Withdraws a token at Google. The local copy is already gone, so failures are only logged. */
async function revokeSealed(
  sync: CalendarSync,
  sealed: string,
  organizationId: string,
  userId: string,
): Promise<void> {
  try {
    await sync.gateway.revoke(sync.box.open(sealed, sealContext(organizationId, userId)));
  } catch (error) {
    logger.warn({ err: error, organizationId }, "could not revoke a google token");
  }
}

/* ------------------------------ busy periods ------------------------------- */

export type BusyLookup =
  /** No connection: nothing to add, the page works as before. */
  | { status: "none" }
  | { status: "ok"; busy: BusyInterval[] }
  /** A connection exists but cannot be read now. Callers must not treat the person as free. */
  | { status: "unavailable" };

/**
 * Busy periods of one member's connected calendar in [now, to). Scoped to the organization the
 * connection was made in. `fresh` skips the one-minute reuse, for decisions that book something.
 */
export async function googleBusyFor(
  deps: Deps,
  target: { organizationId: string; userId: string },
  to: Date,
  options: { fresh?: boolean; now?: Date } = {},
): Promise<BusyLookup> {
  const now = options.now ?? new Date();
  const row = await deps.prisma.calendarConnection.findUnique({
    where: uniqueKey(target.organizationId, target.userId),
  });
  if (!row) return { status: "none" };
  const sync = syncOf(deps);
  if (!sync || row.status !== "ACTIVE") return { status: "unavailable" };

  const cached = busyLookups.get(row.id);
  if (
    !options.fresh &&
    cached &&
    now.getTime() - cached.fetchedAt < BUSY_CACHE_MS &&
    cached.to + BUSY_CACHE_MS >= to.getTime()
  ) {
    return { status: "ok", busy: cached.busy };
  }

  try {
    let access = accessTokens.get(row.id);
    if (!access || access.expiresAt - TOKEN_SLACK_MS <= now.getTime()) {
      const refreshToken = sync.box.open(
        row.refreshTokenSealed,
        sealContext(target.organizationId, target.userId),
      );
      const renewed = await sync.gateway.refreshAccessToken(refreshToken);
      access = {
        token: renewed.accessToken,
        expiresAt: now.getTime() + renewed.expiresInSeconds * 1000,
      };
      remember(accessTokens, row.id, access);
    }
    const busy = await sync.gateway.queryFreeBusy(access.token, now, to);
    remember(busyLookups, row.id, { fetchedAt: now.getTime(), to: to.getTime(), busy });
    return { status: "ok", busy };
  } catch (error) {
    forget(row.id);
    if (error instanceof GoogleAccessRevokedError) {
      await markNeedsReconnect(deps, row.id, target);
    } else {
      logger.warn(
        { err: error, organizationId: target.organizationId, correlationId: deps.correlationId },
        "google busy lookup failed",
      );
    }
    return { status: "unavailable" };
  }
}

async function markNeedsReconnect(
  deps: Deps,
  id: string,
  target: { organizationId: string; userId: string },
) {
  await deps.prisma.$transaction(async (tx) => {
    const { count } = await tx.calendarConnection.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "NEEDS_RECONNECT" },
    });
    if (count === 0) return;
    await recordAuditEvent(tx, {
      organizationId: target.organizationId,
      actorId: null,
      action: "calendar_connection.needs_reconnect",
      resourceType: "calendar_connection",
      resourceId: id,
      metadata: { provider: PROVIDER },
      correlationId: deps.correlationId,
    });
  });
}
