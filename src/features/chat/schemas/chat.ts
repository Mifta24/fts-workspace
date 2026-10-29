import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 4000;
export const EDIT_WINDOW_MS = 15 * 60_000;
export const MESSAGES_PER_MINUTE = 20;
export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;

export const channelIdSchema = z.uuid();
export const messageIdSchema = z.uuid();
export const userIdSchema = z.uuid();

export const createChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,38}$/,
      "Use lowercase letters, numbers and hyphens (2-39 characters)",
    ),
  isPrivate: z.preprocess(
    (value) => value === true || value === "on" || value === "true",
    z.boolean(),
  ),
});

export const messageBodySchema = z.object({
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

export const pageSchema = z.object({
  before: messageIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/** Stable key for a pair of users, independent of who starts the conversation. */
export function dmKeyFor(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
