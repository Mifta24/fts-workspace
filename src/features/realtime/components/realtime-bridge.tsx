"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { io } from "socket.io-client";

/**
 * Connects the page to the realtime gateway and refreshes server-rendered data when an event
 * arrives. Events carry no content: the refresh re-reads everything through the normal,
 * authorized server path. Without a gateway URL this renders nothing and the app still works
 * (data is simply current as of the last navigation or refresh).
 */
export function RealtimeBridge({
  url,
  organizationSlug,
  channelId,
}: {
  url: string | undefined;
  organizationSlug: string;
  channelId?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!url) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Several events in a burst cause one refresh.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };

    const socket = io(url, { withCredentials: true });
    socket.on("connect", () => {
      // Runs again after every reconnect; each join is re-authorized by the gateway.
      socket.emit("subscribe", { organizationSlug });
      if (channelId) socket.emit("join", { organizationSlug, channelId });
      refresh();
    });
    socket.on("message.created", refresh);
    socket.on("message.updated", refresh);
    socket.on("notification.created", refresh);
    socket.on("revoked", refresh);

    return () => {
      clearTimeout(timer);
      socket.disconnect();
    };
  }, [url, organizationSlug, channelId, router]);

  return null;
}
