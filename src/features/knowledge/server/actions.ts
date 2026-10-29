"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import {
  removeFromKnowledge,
  requestIndexing,
} from "@/features/knowledge/server/knowledge-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { toActionError, type ActionState } from "@/server/services/action-result";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function requestIndexingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "knowledge:manage");
  const correlationId = await getCorrelationId();
  try {
    await requestIndexing({ prisma: db(), correlationId }, context, text(formData, "id"));
  } catch (error) {
    return toActionError(error, correlationId, "knowledge.index");
  }
  revalidatePath("/[locale]/w/[organizationSlug]/files", "page");
  revalidatePath("/[locale]/w/[organizationSlug]/knowledge", "page");
  return { ok: true };
}

export async function removeFromKnowledgeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "knowledge:manage");
  const correlationId = await getCorrelationId();
  try {
    await removeFromKnowledge({ prisma: db(), correlationId }, context, text(formData, "id"));
  } catch (error) {
    return toActionError(error, correlationId, "knowledge.remove");
  }
  revalidatePath("/[locale]/w/[organizationSlug]/files", "page");
  revalidatePath("/[locale]/w/[organizationSlug]/knowledge", "page");
  return { ok: true };
}
