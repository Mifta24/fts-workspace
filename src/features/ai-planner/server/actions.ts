"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { MAX_PLAN_TASKS } from "@/features/ai-planner/schemas/plan";
import { applyPlan, discardPlan, generatePlan } from "@/features/ai-planner/server/plan-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { getTaskPlanProvider } from "@/server/ai/provider";
import { toActionError, type ActionState } from "@/server/services/action-result";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function generatePlanAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = text(formData, "organizationSlug");
  const goalId = text(formData, "goalId");
  const context = await requireWorkspace(slug, "ai:use");
  const correlationId = await getCorrelationId();
  let planId: string;
  try {
    const plan = await generatePlan(
      { prisma: db(), correlationId, provider: getTaskPlanProvider() },
      context,
      goalId,
      formData.get("objective"),
    );
    planId = plan.id;
  } catch (error) {
    return toActionError(error, correlationId, "ai.plan.generate");
  }
  return redirect({
    href: `/w/${slug}/goals/${goalId}/plan/${planId}`,
    locale: await getLocale(),
  });
}

export async function applyPlanAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = text(formData, "organizationSlug");
  const context = await requireWorkspace(slug, "task:create");
  const correlationId = await getCorrelationId();

  // The reviewer's (possibly edited) selection: only rows ticked "include" are applied.
  const count = Math.min(Number(text(formData, "count")) || 0, MAX_PLAN_TASKS);
  const selection = [];
  for (let index = 0; index < count; index++) {
    if (formData.get(`include-${index}`) !== "on") continue;
    selection.push({
      title: formData.get(`title-${index}`),
      priority: formData.get(`priority-${index}`),
      estimatedDays: formData.get(`days-${index}`) || undefined,
    });
  }
  try {
    await applyPlan({ prisma: db(), correlationId }, context, text(formData, "planId"), selection);
  } catch (error) {
    return toActionError(error, correlationId, "ai.plan.apply");
  }
  return redirect({ href: `/w/${slug}/tasks`, locale: await getLocale() });
}

export async function discardPlanAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = text(formData, "organizationSlug");
  const context = await requireWorkspace(slug, "ai:use");
  const correlationId = await getCorrelationId();
  try {
    await discardPlan({ prisma: db(), correlationId }, context, text(formData, "planId"));
  } catch (error) {
    return toActionError(error, correlationId, "ai.plan.discard");
  }
  return redirect({
    href: `/w/${slug}/goals/${text(formData, "goalId")}`,
    locale: await getLocale(),
  });
}
