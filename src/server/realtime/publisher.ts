import "server-only";
import { logger } from "@/lib/logger";

/**
 * Events carry identifiers only, never message text. Clients that receive one fetch the
 * content through the normal, authorized read path.
 */
export type RealtimeEvent =
  | { type: "message.created"; organizationId: string; channelId: string; messageId: string }
  | { type: "message.updated"; organizationId: string; channelId: string; messageId: string }
  | {
      type: "notification.created";
      organizationId: string;
      userId: string;
      notificationId: string;
    };

export type RealtimePublisher = (event: RealtimeEvent) => Promise<void>;

let publisher: RealtimePublisher | null = null;

/** Registers the transport (the Socket.IO gateway client). Without one, publishing is a no-op. */
export function setRealtimePublisher(next: RealtimePublisher | null): void {
  publisher = next;
}

/**
 * Best-effort fan-out after the database commit. Realtime is an enhancement: a failure here
 * must never fail the request, because clients can always reload from the database.
 */
export async function publishRealtime(event: RealtimeEvent): Promise<void> {
  if (!publisher) return;
  try {
    await publisher(event);
  } catch (error) {
    logger.warn({ err: error, eventType: event.type }, "realtime publish failed");
  }
}
