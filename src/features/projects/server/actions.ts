"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import {
  archiveProject,
  createProject,
  updateProject,
} from "@/features/projects/server/project-service";
import { toActionError, type ActionState } from "@/server/services/action-result";

export async function createProjectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const context = await requireWorkspace(slug, "project:create");
  const correlationId = await getCorrelationId();
  try {
    await createProject({ prisma: db(), correlationId }, context, {
      name: formData.get("name"),
      description: formData.get("description") ?? undefined,
    });
  } catch (error) {
    return toActionError(error, correlationId, "project.create");
  }
  revalidatePath("/[locale]/w/[organizationSlug]/projects", "page");
  return { ok: true };
}

export async function archiveProjectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const context = await requireWorkspace(slug, "project:archive");
  const correlationId = await getCorrelationId();
  try {
    await archiveProject(
      { prisma: db(), correlationId },
      context,
      String(formData.get("id") ?? ""),
    );
  } catch (error) {
    return toActionError(error, correlationId, "project.archive");
  }
  revalidatePath("/[locale]/w/[organizationSlug]/projects", "page");
  return { ok: true };
}

export async function updateProjectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const context = await requireWorkspace(slug, "project:update");
  const correlationId = await getCorrelationId();
  try {
    await updateProject(
      { prisma: db(), correlationId },
      context,
      String(formData.get("id") ?? ""),
      {
        name: formData.get("name"),
        description: formData.get("description"),
      },
    );
  } catch (error) {
    return toActionError(error, correlationId, "project.update");
  }
  revalidatePath("/[locale]/w/[organizationSlug]/projects", "page");
  revalidatePath("/[locale]/w/[organizationSlug]/projects/[projectId]", "page");
  return { ok: true };
}
