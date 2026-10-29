import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AiFeature } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import type { TextProvider } from "@/server/ai/provider";
import { recordAuditEvent } from "@/server/services/audit";

type Db = Pick<PrismaClient, "aiUsageEvent" | "organization">;

/** All AI features together, per person. */
export const AI_REQUESTS_PER_HOUR = 30;
const HOUR_MS = 3_600_000;
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export async function tokensUsedToday(
  prisma: Db,
  organizationId: string,
  now: Date,
): Promise<number> {
  const sum = await prisma.aiUsageEvent.aggregate({
    where: { organizationId, createdAt: { gte: startOfUtcDay(now) } },
    _sum: { tokens: true },
  });
  return sum._sum.tokens ?? 0;
}

/**
 * Runs one model call under the organization's daily token budget and the per-person hourly
 * request limit, and records the outcome. The ledger holds numbers only, never prompt or answer
 * text. A failed call is recorded too (status ERROR), so a broken provider cannot be hammered
 * for free.
 */
export async function runMeteredCompletion(
  deps: { prisma: PrismaClient },
  context: OrganizationContext,
  feature: AiFeature,
  provider: TextProvider,
  input: { system: string; user: string },
  now: Date = new Date(),
): Promise<string> {
  const { prisma } = deps;
  const organizationId = context.organization.id;

  const recent = await prisma.aiUsageEvent.count({
    where: {
      organizationId,
      userId: context.userId,
      createdAt: { gte: new Date(now.getTime() - HOUR_MS) },
    },
  });
  if (recent >= AI_REQUESTS_PER_HOUR) {
    throw new AppError("RATE_LIMITED", "Too many AI requests. Try again later.");
  }
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { aiDailyTokenBudget: true },
  });
  const promptEstimate = estimateTokens(input.system) + estimateTokens(input.user);
  if (
    (await tokensUsedToday(prisma, organizationId, now)) + promptEstimate >
    organization.aiDailyTokenBudget
  ) {
    throw new AppError("RATE_LIMITED", "The daily AI budget of this workspace is used up.");
  }

  const started = Date.now();
  const record = (status: "OK" | "ERROR", tokens: number, estimated: boolean) =>
    prisma.aiUsageEvent.create({
      data: {
        organizationId,
        userId: context.userId,
        feature,
        provider: provider.name,
        model: provider.model,
        status,
        tokens,
        tokensEstimated: estimated,
        latencyMs: Date.now() - started,
        createdAt: now,
      },
    });

  let text: string;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  try {
    if (provider.generate) {
      const completion = await provider.generate(input);
      text = completion.text;
      inputTokens = completion.usage.inputTokens;
      outputTokens = completion.usage.outputTokens;
    } else {
      text = await provider.complete(input);
    }
  } catch (error) {
    await record("ERROR", promptEstimate, true);
    throw error;
  }
  const reportedTotal =
    inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null;
  await record(
    "OK",
    reportedTotal ?? promptEstimate + estimateTokens(text),
    reportedTotal === null,
  );
  return text;
}

export async function getAiUsage(
  prisma: Db,
  context: OrganizationContext,
  now: Date = new Date(),
): Promise<{ usedToday: number; dailyBudget: number }> {
  requirePermission(context, "ai:use");
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: context.organization.id },
    select: { aiDailyTokenBudget: true },
  });
  return {
    usedToday: await tokensUsedToday(prisma, context.organization.id, now),
    dailyBudget: organization.aiDailyTokenBudget,
  };
}

/** Admins set the ceiling; 0 switches AI off for the workspace. */
export async function setAiDailyBudget(
  deps: { prisma: PrismaClient; correlationId?: string },
  context: OrganizationContext,
  rawBudget: unknown,
): Promise<void> {
  requirePermission(context, "organization:update");
  const isNumeric =
    typeof rawBudget === "number" || (typeof rawBudget === "string" && rawBudget.trim() !== "");
  const budget = isNumeric ? Number(rawBudget) : Number.NaN;
  if (!Number.isInteger(budget) || budget < 0 || budget > 50_000_000) {
    throw new AppError("INVALID_INPUT", "Enter a whole number of tokens between 0 and 50,000,000.");
  }
  await deps.prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: context.organization.id },
      data: { aiDailyTokenBudget: budget },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "ai.budget_changed",
      resourceType: "organization",
      resourceId: context.organization.id,
      metadata: { dailyTokenBudget: budget },
      correlationId: deps.correlationId,
    });
  });
}
