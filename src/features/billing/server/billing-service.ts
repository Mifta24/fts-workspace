import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { FEATURES, type Entitlements, type Feature } from "@/features/billing/schemas/plans";
import { getEntitlements } from "@/features/billing/server/entitlements";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { effectiveDailyBudget, tokensUsedThisMonth, tokensUsedToday } from "@/server/ai/usage";

type Deps = { prisma: PrismaClient };

export type BillingOverview = {
  plan: Entitlements["plan"];
  trialEndsAt: Date | null;
  trialExpired: boolean;
  seats: { members: number; pendingInvitations: number; limit: number | null };
  storage: { usedBytes: number; limitBytes: number };
  ai: {
    usedToday: number;
    dailyLimit: number;
    usedThisMonth: number;
    monthlyLimit: number | null;
  };
  features: Record<Feature, boolean>;
};

/** Plan, limits and current use of the caller's workspace. Counts only; no member or content data. */
export async function getBillingOverview(
  { prisma }: Deps,
  context: OrganizationContext,
  now: Date = new Date(),
): Promise<BillingOverview> {
  requirePermission(context, "billing:read");
  const organizationId = context.organization.id;
  const [entitlements, organization, members, pending, files, usedToday, usedThisMonth] =
    await Promise.all([
      getEntitlements(prisma, organizationId, now),
      prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { aiDailyTokenBudget: true },
      }),
      prisma.member.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.invitation.count({
        where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      }),
      prisma.fileObject.aggregate({
        where: { organizationId, status: "READY" },
        _sum: { sizeBytes: true },
      }),
      tokensUsedToday(prisma, organizationId, now),
      tokensUsedThisMonth(prisma, organizationId, now),
    ]);
  return {
    plan: entitlements.plan,
    trialEndsAt: entitlements.trialEndsAt,
    trialExpired: entitlements.trialExpired,
    seats: { members, pendingInvitations: pending, limit: entitlements.seats },
    storage: { usedBytes: files._sum.sizeBytes ?? 0, limitBytes: entitlements.storageBytes },
    ai: {
      usedToday,
      dailyLimit: effectiveDailyBudget(organization.aiDailyTokenBudget, entitlements.aiDailyTokens),
      usedThisMonth,
      monthlyLimit: entitlements.aiMonthlyTokens,
    },
    features: Object.fromEntries(
      FEATURES.map((feature) => [feature, entitlements.features.includes(feature)]),
    ) as Record<Feature, boolean>,
  };
}
