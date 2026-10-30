import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { RULE_KEYS, setRuleSchema, type RuleKey } from "@/features/automations/schemas/automations";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { AppError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/services/audit";

type Deps = { prisma: PrismaClient; correlationId?: string };

export type RuleView = { key: RuleKey; enabled: boolean };

/** Every built-in rule with its on/off state for this workspace (off when nothing was chosen). */
export async function listRules(
  { prisma }: Deps,
  context: OrganizationContext,
): Promise<RuleView[]> {
  requirePermission(context, "automation:manage");
  const rows = await prisma.automationRule.findMany({
    where: { organizationId: context.organization.id },
    select: { ruleKey: true, enabled: true },
  });
  const state = new Map(rows.map((row) => [row.ruleKey, row.enabled]));
  return RULE_KEYS.map((key) => ({ key, enabled: state.get(key) ?? false }));
}

export async function setRuleEnabled(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawKey: unknown,
  rawEnabled: unknown,
): Promise<void> {
  requirePermission(context, "automation:manage");
  const parsed = setRuleSchema.safeParse({ ruleKey: rawKey, enabled: rawEnabled });
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Choose an automation.");
  const { ruleKey, enabled } = parsed.data;
  const organizationId = context.organization.id;
  await prisma.$transaction(async (tx) => {
    await tx.automationRule.upsert({
      where: { organizationId_ruleKey: { organizationId, ruleKey } },
      create: { organizationId, ruleKey, enabled, updatedById: context.userId },
      update: { enabled, updatedById: context.userId },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: enabled ? "automation.enabled" : "automation.disabled",
      resourceType: "automation_rule",
      metadata: { ruleKey },
      correlationId,
    });
  });
}
