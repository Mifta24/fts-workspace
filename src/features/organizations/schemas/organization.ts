import { z } from "zod";

export const RESERVED_SLUGS = ["api", "admin", "app", "auth", "new", "settings", "w"] as const;

export const organizationSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens")
  .refine((slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug), "This slug is reserved");

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: organizationSlugSchema,
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
