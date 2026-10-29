"use client";

import { useEffect } from "react";
import { markChannelReadAction } from "@/features/chat/server/actions";

/** Marks the open channel as read once it has been displayed (not during server rendering). */
export function MarkRead({
  organizationSlug,
  channelId,
  latestMessageId,
}: {
  organizationSlug: string;
  channelId: string;
  latestMessageId: string | null;
}) {
  useEffect(() => {
    const data = new FormData();
    data.set("organizationSlug", organizationSlug);
    data.set("channelId", channelId);
    void markChannelReadAction({}, data);
  }, [organizationSlug, channelId, latestMessageId]);
  return null;
}
