"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { setRuleEnabled } from "@/features/automations/server/automation-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { toActionError, type ActionState } from "@/server/services/action-result";

export async function setRuleAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "automation:manage",
  );
  const correlationId = await getCorrelationId();
  try {
    await setRuleEnabled(
      { prisma: db(), correlationId },
      context,
      formData.get("ruleKey"),
      formData.get("enabled") === "true",
    );
  } catch (error) {
    return toActionError(error, correlationId, "automation.set");
  }
  revalidatePath("/[locale]/w/[organizationSlug]/automations", "page");
  return { ok: true };
}
