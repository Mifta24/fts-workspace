"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import {
  cancelWorkspaceDeletion,
  requestWorkspaceDeletion,
} from "@/features/organizations/server/deletion-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { toActionError, type ActionState } from "@/server/services/action-result";

export async function requestDeletionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "organization:delete",
  );
  const correlationId = await getCorrelationId();
  try {
    await requestWorkspaceDeletion({ prisma: db(), correlationId }, context, {
      confirm: formData.get("confirm"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "organization.request_deletion");
  }
  revalidatePath("/[locale]/w/[organizationSlug]", "layout");
  return { ok: true };
}

export async function cancelDeletionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(
    String(formData.get("organizationSlug") ?? ""),
    "organization:delete",
  );
  const correlationId = await getCorrelationId();
  try {
    await cancelWorkspaceDeletion({ prisma: db(), correlationId }, context);
  } catch (error) {
    return toActionError(error, correlationId, "organization.cancel_deletion");
  }
  revalidatePath("/[locale]/w/[organizationSlug]", "layout");
  return { ok: true };
}
