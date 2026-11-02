import { z } from "zod";

/** Days between the owner's request and the earliest day an operator may remove the data. */
export const DELETION_GRACE_DAYS = 14;

/** The owner types the workspace address to confirm; this is case-insensitive and trimmed. */
export const requestDeletionSchema = z.object({
  confirm: z.string().trim().min(1).max(80),
});

export const dueAfter = (requestedAt: Date): Date =>
  new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * 86_400_000);
