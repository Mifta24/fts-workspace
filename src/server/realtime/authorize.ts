import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Database-backed authorization for realtime subscriptions. It is deliberately independent of
 * Next.js (no server-only imports) so the gateway process can use it, and it re-reads the
 * canonical rows on every call: a socket's earlier success never grants anything later.
 */
type Db = Pick<PrismaClient, "member" | "channelMember">;

/** Organization id when the user has an ACTIVE membership in the organization with this slug. */
export async function resolveActiveOrganization(
  prisma: Db,
  userId: string,
  organizationSlug: string,
): Promise<string | null> {
  const membership = await prisma.member.findFirst({
    where: { userId, status: "ACTIVE", organization: { slug: organizationSlug.toLowerCase() } },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

/** Channel membership (public channels included) inside an organization where the user is active. */
export async function canReadChannel(
  prisma: Db,
  userId: string,
  organizationId: string,
  channelId: string,
): Promise<boolean> {
  const active = await prisma.member.findFirst({
    where: { userId, organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!active) return false;
  const channelMember = await prisma.channelMember.findFirst({
    where: { userId, organizationId, channelId },
    select: { id: true },
  });
  return channelMember !== null;
}
