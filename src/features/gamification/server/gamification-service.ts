import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  challengeIdSchema,
  createChallengeSchema,
  DAILY_AWARD_CAP,
  LEADERBOARD_LIMIT,
  leaderboardRangeSchema,
  visibilitySchema,
} from "@/features/gamification/schemas/gamification";
import { startOfUtcDay } from "@/features/gamification/server/award";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { recordAuditEvent } from "@/server/services/audit";

type Deps = { prisma: PrismaClient; correlationId?: string };

const DAY_MS = 86_400_000;
const STREAK_LOOKBACK_DAYS = 120;

export type MyStats = {
  totalPoints: number;
  pointsLast7Days: number;
  streakDays: number;
  awardsToday: number;
  dailyCap: number;
  optedIn: boolean;
};

/** The caller's own numbers. Nobody else's are readable through this function. */
export async function getMyStats(
  { prisma }: Deps,
  context: OrganizationContext,
  now: Date = new Date(),
): Promise<MyStats> {
  requirePermission(context, "gamification:read");
  const base = { organizationId: context.organization.id, userId: context.userId };
  const today = startOfUtcDay(now);
  const [total, week, awardsToday, recent, member] = await Promise.all([
    prisma.pointEvent.aggregate({ where: base, _sum: { points: true } }),
    prisma.pointEvent.aggregate({
      where: { ...base, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } },
      _sum: { points: true },
    }),
    prisma.pointEvent.count({ where: { ...base, createdAt: { gte: today } } }),
    prisma.pointEvent.findMany({
      where: {
        ...base,
        createdAt: { gte: new Date(today.getTime() - STREAK_LOOKBACK_DAYS * DAY_MS) },
      },
      select: { createdAt: true },
    }),
    prisma.member.findFirst({
      where: { organizationId: context.organization.id, userId: context.userId },
      select: { showOnLeaderboard: true },
    }),
  ]);
  return {
    totalPoints: total._sum.points ?? 0,
    pointsLast7Days: week._sum.points ?? 0,
    streakDays: computeStreak(
      recent.map((event) => event.createdAt),
      now,
    ),
    awardsToday,
    dailyCap: DAILY_AWARD_CAP,
    optedIn: member?.showOnLeaderboard ?? false,
  };
}

/**
 * Consecutive UTC days with at least one award, counting back from today. A streak that was
 * alive yesterday is still alive today until the day ends.
 */
export function computeStreak(dates: Date[], now: Date): number {
  const days = new Set(dates.map((date) => Math.floor(startOfUtcDay(date).getTime() / DAY_MS)));
  let day = Math.floor(startOfUtcDay(now).getTime() / DAY_MS);
  if (!days.has(day)) day -= 1;
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

export type ChallengeView = {
  id: string;
  title: string;
  description: string | null;
  target: number;
  startsAt: Date;
  endsAt: Date;
  state: "upcoming" | "running" | "ended";
  progress: number;
  completed: boolean;
};

export async function listChallenges(
  { prisma }: Deps,
  context: OrganizationContext,
  now: Date = new Date(),
): Promise<ChallengeView[]> {
  requirePermission(context, "gamification:read");
  const organizationId = context.organization.id;
  const challenges = await prisma.challenge.findMany({
    where: { organizationId, status: "ACTIVE" },
    orderBy: [{ endsAt: "asc" }, { id: "asc" }],
    take: 50,
  });
  return Promise.all(
    challenges.map(async (challenge) => {
      const done = await prisma.pointEvent.count({
        where: {
          organizationId,
          userId: context.userId,
          type: "TASK_COMPLETED",
          createdAt: { gte: challenge.startsAt, lt: challenge.endsAt },
        },
      });
      const progress = Math.min(done, challenge.target);
      return {
        id: challenge.id,
        title: challenge.title,
        description: challenge.description,
        target: challenge.target,
        startsAt: challenge.startsAt,
        endsAt: challenge.endsAt,
        state:
          now < challenge.startsAt ? "upcoming" : now >= challenge.endsAt ? "ended" : "running",
        progress,
        completed: progress >= challenge.target,
      } satisfies ChallengeView;
    }),
  );
}

export async function createChallenge(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(context, "challenge:manage");
  const parsed = createChallengeSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Challenge details are invalid.");
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.challenge.create({
      data: {
        organizationId: context.organization.id,
        createdById: context.userId,
        ...parsed.data,
      },
      select: { id: true },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "challenge.created",
      resourceType: "challenge",
      resourceId: challenge.id,
      correlationId,
    });
    return challenge;
  });
}

export async function archiveChallenge(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  challengeId: string,
): Promise<void> {
  requirePermission(context, "challenge:manage");
  const id = challengeIdSchema.safeParse(challengeId);
  if (!id.success) throw new AppError("NOT_FOUND", "Challenge not found.");
  await prisma.$transaction(async (tx) => {
    const result = await tx.challenge.updateMany({
      where: { id: id.data, organizationId: context.organization.id, status: "ACTIVE" },
      data: { status: "ARCHIVED" },
    });
    if (result.count === 0) throw new AppError("NOT_FOUND", "Challenge not found.");
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "challenge.archived",
      resourceType: "challenge",
      resourceId: id.data,
      correlationId,
    });
  });
}

export type Leaderboard =
  | { enabled: false }
  | { enabled: true; entries: { rank: number; userId: string; name: string; points: number }[] };

/**
 * Rankings, only when the organization turned them on, and only listing members who opted in.
 * Everyone else's points stay private even from admins (there is no "show all" mode).
 */
export async function getLeaderboard(
  { prisma }: Deps,
  context: OrganizationContext,
  rawRange: unknown = "week",
  now: Date = new Date(),
): Promise<Leaderboard> {
  requirePermission(context, "gamification:read");
  const range = leaderboardRangeSchema.safeParse(rawRange);
  if (!range.success) throw new AppError("INVALID_INPUT", "Range is invalid.");
  const organizationId = context.organization.id;

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { leaderboardVisibility: true },
  });
  if (organization.leaderboardVisibility === "OFF") return { enabled: false };

  const since =
    range.data === "all"
      ? undefined
      : new Date(now.getTime() - (range.data === "week" ? 7 : 30) * DAY_MS);
  const optedIn = await prisma.member.findMany({
    where: { organizationId, status: "ACTIVE", showOnLeaderboard: true },
    select: { userId: true, user: { select: { name: true } } },
  });
  const names = new Map(optedIn.map((member) => [member.userId, member.user.name]));
  const totals = await prisma.pointEvent.groupBy({
    by: ["userId"],
    where: {
      organizationId,
      userId: { in: [...names.keys()] },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    _sum: { points: true },
  });
  const sorted = totals
    .map((row) => ({ userId: row.userId, points: row._sum.points ?? 0 }))
    .sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId))
    .slice(0, LEADERBOARD_LIMIT);
  return {
    enabled: true,
    entries: sorted.map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      name: names.get(entry.userId) ?? "—",
      points: entry.points,
    })),
  };
}

/** Each person decides for themselves whether they appear. */
export async function setLeaderboardOptIn(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  optIn: boolean,
): Promise<void> {
  requirePermission(context, "gamification:read");
  await prisma.$transaction(async (tx) => {
    await tx.member.update({
      where: { id: context.membershipId },
      data: { showOnLeaderboard: optIn },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: optIn ? "leaderboard.opted_in" : "leaderboard.opted_out",
      resourceType: "member",
      resourceId: context.userId,
      correlationId,
    });
  });
}

/** Organization policy: admins can switch rankings on (opt-in only) or off. */
export async function setLeaderboardVisibility(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawVisibility: unknown,
): Promise<void> {
  requirePermission(context, "organization:update");
  const visibility = visibilitySchema.safeParse(rawVisibility);
  if (!visibility.success) throw new AppError("INVALID_INPUT", "Visibility is invalid.");
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: context.organization.id },
      data: { leaderboardVisibility: visibility.data },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "leaderboard.visibility_changed",
      resourceType: "organization",
      resourceId: context.organization.id,
      metadata: { visibility: visibility.data },
      correlationId,
    });
  });
}
