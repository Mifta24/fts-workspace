"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { addComment, createTask, updateTask } from "@/features/tasks/server/task-service";
import { toActionError, type ActionState } from "@/server/services/action-result";

const TASKS_PATH = "/[locale]/w/[organizationSlug]/tasks";

export async function createTaskAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const context = await requireWorkspace(slug, "task:create");
  const correlationId = await getCorrelationId();
  try {
    await createTask({ prisma: db(), correlationId }, context, {
      title: formData.get("title"),
      description: formData.get("description"),
      goalId: formData.get("goalId"),
      projectId: formData.get("projectId"),
      assigneeId: formData.get("assigneeId"),
      priority: formData.get("priority") ?? undefined,
      dueAt: formData.get("dueAt"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "task.create");
  }
  revalidatePath(TASKS_PATH, "page");
  return { ok: true };
}

/** Updates the task from the detail page; only submitted fields change ("" clears nullable ones). */
export async function updateTaskAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const context = await requireWorkspace(slug, "task:update");
  const correlationId = await getCorrelationId();
  const input: Record<string, FormDataEntryValue> = {};
  for (const key of [
    "title",
    "description",
    "status",
    "priority",
    "assigneeId",
    "goalId",
    "projectId",
    "dueAt",
  ]) {
    const value = formData.get(key);
    if (value !== null) input[key] = value;
  }
  try {
    await updateTask(
      { prisma: db(), correlationId },
      context,
      String(formData.get("id") ?? ""),
      input,
    );
  } catch (error) {
    return toActionError(error, correlationId, "task.update");
  }
  revalidatePath(TASKS_PATH, "page");
  revalidatePath(`${TASKS_PATH}/[taskId]`, "page");
  return { ok: true };
}

export async function addCommentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const context = await requireWorkspace(slug, "task:comment");
  const correlationId = await getCorrelationId();
  try {
    await addComment({ prisma: db(), correlationId }, context, String(formData.get("id") ?? ""), {
      body: formData.get("body"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "task.comment");
  }
  revalidatePath(`${TASKS_PATH}/[taskId]`, "page");
  return { ok: true };
}
