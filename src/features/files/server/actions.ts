"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import {
  deleteFile,
  setVisibility,
  shareFile,
  unshareFile,
} from "@/features/files/server/file-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { getStorage } from "@/server/storage/storage";
import { toActionError, type ActionState } from "@/server/services/action-result";

const FILES_PATH = "/[locale]/w/[organizationSlug]/files";
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function deleteFileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "file:read");
  const correlationId = await getCorrelationId();
  try {
    await deleteFile(
      { prisma: db(), storage: getStorage(), correlationId },
      context,
      text(formData, "id"),
    );
  } catch (error) {
    return toActionError(error, correlationId, "file.delete");
  }
  revalidatePath(FILES_PATH, "page");
  return { ok: true };
}

export async function setVisibilityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "file:upload");
  const correlationId = await getCorrelationId();
  try {
    await setVisibility(
      { prisma: db(), correlationId },
      context,
      text(formData, "id"),
      formData.get("visibility"),
    );
  } catch (error) {
    return toActionError(error, correlationId, "file.visibility");
  }
  revalidatePath(FILES_PATH, "layout");
  return { ok: true };
}

export async function shareFileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "file:upload");
  const correlationId = await getCorrelationId();
  try {
    await shareFile(
      { prisma: db(), correlationId },
      context,
      text(formData, "id"),
      text(formData, "userId"),
    );
  } catch (error) {
    return toActionError(error, correlationId, "file.share");
  }
  revalidatePath(FILES_PATH, "layout");
  return { ok: true };
}

export async function unshareFileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "file:upload");
  const correlationId = await getCorrelationId();
  try {
    await unshareFile(
      { prisma: db(), correlationId },
      context,
      text(formData, "id"),
      text(formData, "userId"),
    );
  } catch (error) {
    return toActionError(error, correlationId, "file.unshare");
  }
  revalidatePath(FILES_PATH, "layout");
  return { ok: true };
}
