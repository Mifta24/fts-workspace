"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import {
  addMilestone,
  deleteMilestone,
  setMilestoneCompleted,
} from "@/features/milestones/server/milestone-service";
import { toActionError, type ActionState } from "@/server/services/action-result";

const GOAL_PATH = "/[locale]/w/[organizationSlug]/goals/[goalId]";
const GOALS_PATH = "/[locale]/w/[organizationSlug]/goals";

export async function addMilestoneAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "goal:update",
  );
  const correlationId = await getCorrelationId();
  try {
    await addMilestone(
      { prisma: db(), correlationId },
      context,
      String(formData.get("goalId") ?? ""),
      {
        title: formData.get("title"),
        dueAt: formData.get("dueAt"),
      },
    );
  } catch (error) {
    return toActionError(error, correlationId, "milestone.add");
  }
  revalidatePath(GOAL_PATH, "page");
  revalidatePath(GOALS_PATH, "page");
  return { ok: true };
}

export async function toggleMilestoneAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "goal:update",
  );
  const correlationId = await getCorrelationId();
  try {
    await setMilestoneCompleted(
      { prisma: db(), correlationId },
      context,
      String(formData.get("id") ?? ""),
      formData.get("completed") === "true",
    );
  } catch (error) {
    return toActionError(error, correlationId, "milestone.toggle");
  }
  revalidatePath(GOAL_PATH, "page");
  revalidatePath(GOALS_PATH, "page");
  return { ok: true };
}

export async function deleteMilestoneAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "goal:update",
  );
  const correlationId = await getCorrelationId();
  try {
    await deleteMilestone(
      { prisma: db(), correlationId },
      context,
      String(formData.get("id") ?? ""),
    );
  } catch (error) {
    return toActionError(error, correlationId, "milestone.delete");
  }
  revalidatePath(GOAL_PATH, "page");
  revalidatePath(GOALS_PATH, "page");
  return { ok: true };
}
