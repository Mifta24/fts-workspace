import { z } from "zod";

/**
 * Wire contract between the app, the gateway and browsers. No file here imports server-only
 * modules, so the gateway process (plain Node) and tests can use it too.
 */

const uuid = z.uuid();

/** Events the app publishes to the gateway. Identifiers only, never message text. */
export const publishEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message.created"),
    organizationId: uuid,
    channelId: uuid,
    messageId: uuid,
  }),
  z.object({
    type: z.literal("message.updated"),
    organizationId: uuid,
    channelId: uuid,
    messageId: uuid,
  }),
  z.object({
    type: z.literal("notification.created"),
    organizationId: uuid,
    userId: uuid,
    notificationId: uuid,
  }),
]);
export type PublishEvent = z.infer<typeof publishEventSchema>;

/** Client → gateway. The organization is named by slug and resolved against the database. */
export const subscribeSchema = z.object({
  organizationSlug: z.string().min(3).max(48),
});
export const joinChannelSchema = z.object({
  organizationSlug: z.string().min(3).max(48),
  channelId: uuid,
});

export const userRoom = (organizationId: string, userId: string) =>
  `org:${organizationId}:user:${userId}`;
export const channelRoom = (organizationId: string, channelId: string) =>
  `org:${organizationId}:channel:${channelId}`;
