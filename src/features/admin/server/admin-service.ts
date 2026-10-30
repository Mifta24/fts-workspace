import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { searchSchema, setPlanSchema, setSuspendedSchema } from "@/features/admin/schemas/admin";
import { resolveEntitlements, type Entitlements } from "@/features/billing/schemas/plans";
import { AppError } from "@/lib/errors";
import { startOfUtcMonth } from "@/server/ai/usage";
import { recordAuditEvent } from "@/server/services/audit";

type Deps = { prisma: PrismaClient; correlationId?: string };

declare const operatorBrand: unique symbol;
/**
 * A verified platform operator. It can only be made by `resolveOperator`, so every function below
 * is unreachable without going through the allow-list check. Operators work across tenants by
 * design: everything they change is written to the audit trail, and what they read is counts and
 * workspace names, never member content.
 */
export type Operator = { userId: string; email: string; readonly [operatorBrand]: true };

/** The operator for a verified session user, or null when the email is not on the allow-list. */
export function resolveOperator(
  user: { id: string; email: string; emailVerified: boolean } | null,
  allowList: readonly string[],
): Operator | null {
  if (!user?.emailVerified) return null;
  const email = user.email.toLowerCase();
  if (!allowList.includes(email)) return null;
  return { userId: user.id, email } as Operator;
}

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  suspended: boolean;
  plan: Entitlements["plan"];
  /** The plan as stored (a trial that ran out is still stored as TRIALING). */
  trialEndsAt: Date | null;
  trialExpired: boolean;
  members: number;
  aiTokensThisMonth: number;
};

const MAX_ROWS = 100;

export async function listWorkspaces(
  { prisma }: Deps,
  _operator: Operator,
  rawSearch: unknown,
  now: Date = new Date(),
): Promise<WorkspaceRow[]> {
  const search = searchSchema.safeParse(rawSearch ?? "");
  if (!search.success) throw new AppError("INVALID_INPUT", "The search text is too long.");
  const organizations = await prisma.organization.findMany({
    where: search.data
      ? {
          OR: [
            { name: { contains: search.data, mode: "insensitive" } },
            { slug: { contains: search.data.toLowerCase() } },
          ],
        }
      : {},
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      suspendedAt: true,
      subscription: { select: { planKey: true, status: true, trialEndsAt: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: MAX_ROWS,
  });
  const ids = organizations.map((organization) => organization.id);
  const [members, tokens] = await Promise.all([
    prisma.member.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: ids }, status: "ACTIVE" },
      _count: { _all: true },
    }),
    prisma.aiUsageEvent.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: ids }, createdAt: { gte: startOfUtcMonth(now) } },
      _sum: { tokens: true },
    }),
  ]);
  const memberCount = new Map(members.map((row) => [row.organizationId, row._count._all]));
  const tokenSum = new Map(tokens.map((row) => [row.organizationId, row._sum.tokens ?? 0]));
  return organizations.map((organization) => {
    const entitlements = resolveEntitlements(organization.subscription, now);
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      suspended: organization.suspendedAt !== null,
      plan: entitlements.plan,
      trialEndsAt: entitlements.trialEndsAt,
      trialExpired: entitlements.trialExpired,
      members: memberCount.get(organization.id) ?? 0,
      aiTokensThisMonth: tokenSum.get(organization.id) ?? 0,
    };
  });
}

/** Sets a workspace's plan (or removes it with UNMETERED). Idempotent: repeating it changes nothing. */
export async function setWorkspacePlan(
  { prisma, correlationId }: Deps,
  operator: Operator,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<void> {
  const parsed = setPlanSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Choose a workspace and a plan.");
  const { organizationId, plan, trialDays } = parsed.data;
  if (plan === "UNMETERED" && trialDays !== undefined) {
    throw new AppError("INVALID_INPUT", "An unmetered workspace has no trial.");
  }
  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, subscription: { select: { planKey: true, status: true } } },
    });
    if (!organization) throw new AppError("NOT_FOUND", "Workspace not found.");
    const before = organization.subscription
      ? `${organization.subscription.planKey}/${organization.subscription.status}`
      : "UNMETERED";

    let after: string;
    if (plan === "UNMETERED") {
      await tx.subscription.deleteMany({ where: { organizationId } });
      after = "UNMETERED";
    } else {
      const status = trialDays === undefined ? ("ACTIVE" as const) : ("TRIALING" as const);
      const trialEndsAt =
        trialDays === undefined ? null : new Date(now.getTime() + trialDays * 86_400_000);
      await tx.subscription.upsert({
        where: { organizationId },
        create: { organizationId, planKey: plan, status, trialEndsAt },
        update: { planKey: plan, status, trialEndsAt },
      });
      after = `${plan}/${status}`;
    }
    await recordAuditEvent(tx, {
      organizationId,
      actorId: operator.userId,
      action: "billing.plan_changed",
      resourceType: "subscription",
      resourceId: organizationId,
      metadata: { from: before, to: after, ...(trialDays ? { trialDays } : {}) },
      correlationId,
    });
  });
}

/** Switches a workspace off or on. Nothing is deleted; members simply cannot reach it meanwhile. */
export async function setWorkspaceSuspended(
  { prisma, correlationId }: Deps,
  operator: Operator,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<void> {
  const parsed = setSuspendedSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Choose a workspace.");
  const { organizationId, suspended } = parsed.data;
  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { suspendedAt: true },
    });
    if (!organization) throw new AppError("NOT_FOUND", "Workspace not found.");
    if ((organization.suspendedAt !== null) === suspended) return;
    await tx.organization.update({
      where: { id: organizationId },
      data: { suspendedAt: suspended ? now : null },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: operator.userId,
      action: suspended ? "organization.suspended" : "organization.unsuspended",
      resourceType: "organization",
      resourceId: organizationId,
      correlationId,
    });
  });
}

export type OperationsSnapshot = {
  workspaces: number;
  suspendedWorkspaces: number;
  users: number;
  signupsLast24h: number;
  jobs: {
    queued: number;
    /** Seconds the oldest due job has been waiting; null when nothing is due. */
    oldestDueSeconds: number | null;
    failedLast24h: number;
    /** Running for longer than the lock timeout: the worker probably died. */
    stuck: number;
  };
  ai: { callsLast24h: number; errorsLast24h: number };
};

/** A running job whose lock is older than this is reported as stuck. */
export const STUCK_JOB_MS = 15 * 60_000;
const DAY = 86_400_000;

/** Platform health in counts only, for the operator page. No tenant content. */
export async function getOperationsSnapshot(
  { prisma }: Deps,
  _operator: Operator,
  now: Date = new Date(),
): Promise<OperationsSnapshot> {
  const since = new Date(now.getTime() - DAY);
  const [
    workspaces,
    suspendedWorkspaces,
    users,
    signups,
    queued,
    oldestDue,
    failed,
    stuck,
    aiCalls,
    aiErrors,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { suspendedAt: { not: null } } }),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.job.count({ where: { status: "QUEUED", organization: { suspendedAt: null } } }),
    prisma.job.findFirst({
      where: { status: "QUEUED", runAt: { lte: now }, organization: { suspendedAt: null } },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
    prisma.job.count({ where: { status: "FAILED", finishedAt: { gte: since } } }),
    prisma.job.count({
      where: { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - STUCK_JOB_MS) } },
    }),
    prisma.aiUsageEvent.count({ where: { createdAt: { gte: since } } }),
    prisma.aiUsageEvent.count({ where: { createdAt: { gte: since }, status: "ERROR" } }),
  ]);
  return {
    workspaces,
    suspendedWorkspaces,
    users,
    signupsLast24h: signups,
    jobs: {
      queued,
      oldestDueSeconds: oldestDue
        ? Math.max(0, Math.round((now.getTime() - oldestDue.runAt.getTime()) / 1000))
        : null,
      failedLast24h: failed,
      stuck,
    },
    ai: { callsLast24h: aiCalls, errorsLast24h: aiErrors },
  };
}
