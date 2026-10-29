"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { archiveGoal, createGoal } from "@/features/goals/server/goal-service";
import { toActionError, type ActionState } from "@/server/services/action-result";

export async function createGoalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const context = await requireWorkspace(slug, "goal:create");
  const correlationId = await getCorrelationId();
  try {
    await createGoal({ prisma: db(), correlationId }, context, {
      title: formData.get("title"),
      description: formData.get("description"),
      projectId: formData.get("projectId"),
      parentGoalId: formData.get("parentGoalId"),
      progressMode: formData.get("progressMode") ?? undefined,
      manualProgress: formData.get("manualProgress"),
      targetValue: formData.get("targetValue"),
      currentValue: formData.get("currentValue"),
      dueAt: formData.get("dueAt"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "goal.create");
  }
  revalidatePath("/[locale]/w/[organizationSlug]/goals", "page");
  return { ok: true };
}

export async function archiveGoalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const context = await requireWorkspace(slug, "goal:archive");
  const correlationId = await getCorrelationId();
  try {
    await archiveGoal({ prisma: db(), correlationId }, context, String(formData.get("id") ?? ""));
  } catch (error) {
    return toActionError(error, correlationId, "goal.archive");
  }
  revalidatePath("/[locale]/w/[organizationSlug]/goals", "page");
  return { ok: true };
}
