"use server";

import { revalidatePath } from "next/cache";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import {
  archiveChallenge,
  createChallenge,
  setLeaderboardOptIn,
  setLeaderboardVisibility,
} from "@/features/gamification/server/gamification-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { toActionError, type ActionState } from "@/server/services/action-result";

const PROGRESS_PATH = "/[locale]/w/[organizationSlug]/progress";
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function createChallengeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "challenge:manage");
  const correlationId = await getCorrelationId();
  try {
    await createChallenge({ prisma: db(), correlationId }, context, {
      title: formData.get("title"),
      description: formData.get("description"),
      target: formData.get("target"),
      startsAt: formData.get("startsAt"),
      endsAt: formData.get("endsAt"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "challenge.create");
  }
  revalidatePath(PROGRESS_PATH, "page");
  return { ok: true };
}

export async function archiveChallengeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "challenge:manage");
  const correlationId = await getCorrelationId();
  try {
    await archiveChallenge({ prisma: db(), correlationId }, context, text(formData, "id"));
  } catch (error) {
    return toActionError(error, correlationId, "challenge.archive");
  }
  revalidatePath(PROGRESS_PATH, "page");
  return { ok: true };
}

export async function setLeaderboardOptInAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "gamification:read");
  const correlationId = await getCorrelationId();
  try {
    await setLeaderboardOptIn(
      { prisma: db(), correlationId },
      context,
      text(formData, "optIn") === "true",
    );
  } catch (error) {
    return toActionError(error, correlationId, "leaderboard.opt_in");
  }
  revalidatePath(PROGRESS_PATH, "page");
  return { ok: true };
}

export async function setLeaderboardVisibilityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "organization:update");
  const correlationId = await getCorrelationId();
  try {
    await setLeaderboardVisibility(
      { prisma: db(), correlationId },
      context,
      text(formData, "visibility"),
    );
  } catch (error) {
    return toActionError(error, correlationId, "leaderboard.visibility");
  }
  revalidatePath(PROGRESS_PATH, "page");
  return { ok: true };
}
