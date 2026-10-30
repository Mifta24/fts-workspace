import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  resolveEntitlements,
  type Entitlements,
  type Feature,
} from "@/features/billing/schemas/plans";
import { AppError } from "@/lib/errors";

type Reader = Pick<Prisma.TransactionClient, "subscription">;
type SeatClient = Pick<Prisma.TransactionClient, "subscription" | "member" | "invitation"> &
  Pick<Prisma.TransactionClient, "$executeRaw">;

/** What the workspace may do right now. Always read from the database; never cached per request. */
export async function getEntitlements(
  client: Reader,
  organizationId: string,
  now: Date = new Date(),
): Promise<Entitlements> {
  const row = await client.subscription.findUnique({
    where: { organizationId },
    select: { planKey: true, status: true, trialEndsAt: true },
  });
  return resolveEntitlements(row, now);
}

/** Throws PLAN_LIMIT when the workspace's plan does not include the feature. */
export async function requireFeature(
  client: Reader,
  organizationId: string,
  feature: Feature,
  now: Date = new Date(),
): Promise<Entitlements> {
  const entitlements = await getEntitlements(client, organizationId, now);
  if (!entitlements.features.includes(feature)) {
    throw new AppError("PLAN_LIMIT", "Your plan does not include this feature.");
  }
  return entitlements;
}

/**
 * Throws PLAN_LIMIT when adding one more person would pass the plan's seats. Seats are active
 * members, plus pending invitations when `reserve` is set (inviting reserves a seat; accepting
 * one converts it). Call inside the transaction that adds the person: the lock serializes
 * concurrent invitations and acceptances of one workspace, so the limit cannot be passed by a race.
 */
export async function assertSeatAvailable(
  tx: SeatClient,
  organizationId: string,
  now: Date,
  { reserve }: { reserve: boolean },
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`seats:${organizationId}`}, 0))`;
  const { seats } = await getEntitlements(tx, organizationId, now);
  if (seats === null) return;
  const [members, pending] = await Promise.all([
    tx.member.count({ where: { organizationId, status: "ACTIVE" } }),
    reserve
      ? tx.invitation.count({
          where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        })
      : Promise.resolve(0),
  ]);
  if (members + pending >= seats) {
    throw new AppError("PLAN_LIMIT", "Your plan has no free seat left.");
  }
}

/**
 * Whether the public links (forms, booking pages) of a workspace may answer. They answer anonymous
 * visitors, so a workspace that left the plan, or was suspended, simply stops being found.
 */
export async function publicPagesOpen(
  client: Reader,
  organization: { id: string; suspendedAt: Date | null },
  now: Date = new Date(),
): Promise<boolean> {
  if (organization.suspendedAt) return false;
  return (await getEntitlements(client, organization.id, now)).features.includes("publicPages");
}
