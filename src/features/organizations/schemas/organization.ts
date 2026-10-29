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

/** Roles that can be granted by invitation. OWNER is never invitable. */
export const INVITABLE_ROLES = ["ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role: z.enum(INVITABLE_ROLES),
});

export const invitationIdSchema = z.uuid();
/** 32 random bytes, base64url. */
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
