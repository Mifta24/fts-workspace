import { z } from "zod";

export const milestoneIdSchema = z.uuid();

export const MAX_MILESTONES_PER_GOAL = 50;

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

export const createMilestoneSchema = z.object({
  title: z.string().trim().min(2).max(160),
  dueAt: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
});

export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
