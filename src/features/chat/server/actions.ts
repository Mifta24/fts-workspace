"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import {
  createChannel,
  deleteMessage,
  editMessage,
  joinChannel,
  markChannelRead,
  postMessage,
  startDirectMessage,
} from "@/features/chat/server/chat-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { toActionError, type ActionState } from "@/server/services/action-result";

const CHAT_PATH = "/[locale]/w/[organizationSlug]/chat";
const CHANNEL_PATH = "/[locale]/w/[organizationSlug]/chat/[channelId]";
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function createChannelAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = text(formData, "organizationSlug");
  const context = await requireWorkspace(slug, "chat:manage");
  const correlationId = await getCorrelationId();
  let channelId: string;
  try {
    ({ id: channelId } = await createChannel({ prisma: db(), correlationId }, context, {
      name: formData.get("name"),
      isPrivate: formData.get("isPrivate") === "on",
    }));
  } catch (error) {
    return toActionError(error, correlationId, "channel.create");
  }
  return redirect({ href: `/w/${slug}/chat/${channelId}`, locale: await getLocale() });
}

export async function joinChannelAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = text(formData, "organizationSlug");
  const context = await requireWorkspace(slug, "chat:read");
  const correlationId = await getCorrelationId();
  const channelId = text(formData, "channelId");
  try {
    await joinChannel({ prisma: db(), correlationId }, context, channelId);
  } catch (error) {
    return toActionError(error, correlationId, "channel.join");
  }
  return redirect({ href: `/w/${slug}/chat/${channelId}`, locale: await getLocale() });
}

export async function startDirectMessageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = text(formData, "organizationSlug");
  const context = await requireWorkspace(slug, "chat:post");
  const correlationId = await getCorrelationId();
  let channelId: string;
  try {
    ({ id: channelId } = await startDirectMessage(
      { prisma: db(), correlationId },
      context,
      text(formData, "userId"),
    ));
  } catch (error) {
    return toActionError(error, correlationId, "dm.start");
  }
  return redirect({ href: `/w/${slug}/chat/${channelId}`, locale: await getLocale() });
}

export async function postMessageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "chat:post");
  const correlationId = await getCorrelationId();
  try {
    await postMessage({ prisma: db(), correlationId }, context, text(formData, "channelId"), {
      body: formData.get("body"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "message.post");
  }
  revalidatePath(CHANNEL_PATH, "page");
  return { ok: true };
}

export async function editMessageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "chat:post");
  const correlationId = await getCorrelationId();
  try {
    await editMessage({ prisma: db(), correlationId }, context, text(formData, "id"), {
      body: formData.get("body"),
    });
  } catch (error) {
    return toActionError(error, correlationId, "message.edit");
  }
  revalidatePath(CHANNEL_PATH, "page");
  return { ok: true };
}

export async function deleteMessageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "chat:read");
  const correlationId = await getCorrelationId();
  try {
    await deleteMessage({ prisma: db(), correlationId }, context, text(formData, "id"));
  } catch (error) {
    return toActionError(error, correlationId, "message.delete");
  }
  revalidatePath(CHANNEL_PATH, "page");
  return { ok: true };
}

export async function markChannelReadAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireWorkspace(text(formData, "organizationSlug"), "chat:read");
  const correlationId = await getCorrelationId();
  try {
    await markChannelRead({ prisma: db(), correlationId }, context, text(formData, "channelId"));
  } catch (error) {
    return toActionError(error, correlationId, "channel.read");
  }
  revalidatePath(CHAT_PATH, "page");
  return { ok: true };
}
