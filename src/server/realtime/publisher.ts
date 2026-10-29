import "server-only";
import { env } from "@/lib/env";
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
let httpPublisher: RealtimePublisher | null | undefined;

const PUBLISH_TIMEOUT_MS = 2000;

/** HTTP transport to the gateway, configured by REALTIME_URL and REALTIME_PUBLISH_SECRET. */
function getHttpPublisher(): RealtimePublisher | null {
  if (httpPublisher !== undefined) return httpPublisher;
  const { REALTIME_URL, REALTIME_PUBLISH_SECRET } = env();
  if (!REALTIME_URL || !REALTIME_PUBLISH_SECRET) {
    httpPublisher = null;
    return null;
  }
  const endpoint = `${REALTIME_URL.replace(/\/+$/, "")}/internal/publish`;
  httpPublisher = async (event) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-realtime-secret": REALTIME_PUBLISH_SECRET },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`gateway answered ${response.status}`);
  };
  return httpPublisher;
}

/** Registers the transport (the Socket.IO gateway client). Without one, publishing is a no-op. */
export function setRealtimePublisher(next: RealtimePublisher | null): void {
  publisher = next;
}

/**
 * Best-effort fan-out after the database commit. Realtime is an enhancement: a failure here
 * must never fail the request, because clients can always reload from the database.
 */
export async function publishRealtime(event: RealtimeEvent): Promise<void> {
  try {
    const transport = publisher ?? getHttpPublisher();
    if (!transport) return;
    await transport(event);
  } catch (error) {
    logger.warn({ err: error, eventType: event.type }, "realtime publish failed");
  }
}
