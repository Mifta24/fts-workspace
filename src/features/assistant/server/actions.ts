"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { answerQuestion, type Answer } from "@/features/assistant/server/assistant-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { getTaskPlanProvider } from "@/server/ai/provider";
import { setAiDailyBudget } from "@/server/ai/usage";
import { toActionError, type ActionState } from "@/server/services/action-result";

export type AskState = ActionState & { result?: Answer };

export async function askAction(_previous: AskState, formData: FormData): Promise<AskState> {
  const context = await requireWorkspace(String(formData.get("organizationSlug") ?? ""), "ai:use");
  const correlationId = await getCorrelationId();
  try {
    const result = await answerQuestion(
      { prisma: db(), correlationId, provider: getTaskPlanProvider() },
      context,
      formData.get("question"),
    );
    return { ok: true, result };
  } catch (error) {
    return toActionError(error, correlationId, "assistant.ask");
  }
}

export async function setBudgetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "organization:update",
  );
  const correlationId = await getCorrelationId();
  try {
    await setAiDailyBudget({ prisma: db(), correlationId }, context, formData.get("budget"));
  } catch (error) {
    return toActionError(error, correlationId, "assistant.budget");
  }
  revalidatePath("/[locale]/w/[organizationSlug]/assistant", "page");
  return { ok: true };
}
