import { z } from "zod";

export const projectIdSchema = z.uuid();

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => value || undefined),
});

export const updateProjectSchema = createProjectSchema.partial();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
