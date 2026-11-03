"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import {
  purgeWorkspaceAsOperator,
  setWorkspacePlan,
  setWorkspaceSuspended,
} from "@/features/admin/server/admin-service";
import { requireOperator } from "@/features/admin/server/require-operator";
import { toActionError, type ActionState } from "@/server/services/action-result";
import { getStorage } from "@/server/storage/storage";

const ADMIN_PATH = "/[locale]/admin";

export async function setPlanAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const correlationId = await getCorrelationId();
  const trial = String(formData.get("trialDays") ?? "").trim();
  try {
    await setWorkspacePlan({ prisma: db(), correlationId }, operator, {
      organizationId: formData.get("organizationId"),
      plan: formData.get("plan"),
      trialDays: trial === "" ? undefined : trial,
    });
  } catch (error) {
    return toActionError(error, correlationId, "admin.set_plan");
  }
  revalidatePath(ADMIN_PATH, "page");
  return { ok: true };
}

export async function setSuspendedAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const correlationId = await getCorrelationId();
  try {
    await setWorkspaceSuspended({ prisma: db(), correlationId }, operator, {
      organizationId: formData.get("organizationId"),
      suspended: formData.get("suspended") === "true",
    });
  } catch (error) {
    return toActionError(error, correlationId, "admin.set_suspended");
  }
  revalidatePath(ADMIN_PATH, "page");
  return { ok: true };
}

export async function purgeWorkspaceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const correlationId = await getCorrelationId();
  try {
    await purgeWorkspaceAsOperator(
      { prisma: db(), storage: getStorage(), correlationId },
      operator,
      {
        organizationId: formData.get("organizationId"),
        confirm: formData.get("confirm"),
      },
    );
  } catch (error) {
    return toActionError(error, correlationId, "admin.purge_workspace");
  }
  revalidatePath(ADMIN_PATH, "page");
  return { ok: true };
}
