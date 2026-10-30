import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  isOrganizationRole,
  permissionsForRole,
  roleHasPermission,
  type OrganizationRole,
  type Permission,
} from "@/lib/permissions/matrix";
import { TRIAL_PLAN } from "@/features/billing/schemas/plans";
import { recordAuditEvent } from "@/server/services/audit";
import {
  createOrganizationSchema,
  organizationSlugSchema,
} from "@/features/organizations/schemas/organization";

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
};

/** Server-resolved tenant context. Never build this from client-supplied ids. */
export type OrganizationContext = {
  userId: string;
  organization: { id: string; name: string; slug: string };
  membershipId: string;
  role: OrganizationRole;
  permissions: Permission[];
};

type Deps = { prisma: PrismaClient; correlationId?: string };

export async function createOrganization(
  { prisma, correlationId }: Deps,
  actorId: string,
  rawInput: unknown,
  options: { trialDays?: number } = {},
): Promise<OrganizationSummary> {
  const parsed = createOrganizationSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Organization details are invalid.");
  const input = parsed.data;

  try {
    return await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          members: { create: { userId: actorId, role: "OWNER" } },
          // Only when billing is switched on: a new workspace starts with a time-limited trial.
          ...(options.trialDays
            ? {
                subscription: {
                  create: {
                    planKey: TRIAL_PLAN,
                    status: "TRIALING" as const,
                    trialEndsAt: new Date(Date.now() + options.trialDays * 86_400_000),
                  },
                },
              }
            : {}),
        },
      });
      await recordAuditEvent(tx, {
        organizationId: organization.id,
        actorId,
        action: "organization.created",
        resourceType: "organization",
        resourceId: organization.id,
        metadata: { slug: organization.slug },
        correlationId,
      });
      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role: "OWNER" as const,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "This organization URL is already taken.");
    }
    throw error;
  }
}

/** Organizations where the user has an ACTIVE membership. */
export async function listUserOrganizations(
  { prisma }: Deps,
  userId: string,
): Promise<OrganizationSummary[]> {
  const memberships = await prisma.member.findMany({
    where: { userId, status: "ACTIVE", organization: { suspendedAt: null } },
    include: { organization: { select: { id: true, name: true, slug: true } } },
    orderBy: { organization: { name: "asc" } },
  });
  return memberships.flatMap((membership) =>
    isOrganizationRole(membership.role)
      ? [{ ...membership.organization, role: membership.role }]
      : [],
  );
}

/**
 * Resolves the organization for a user from the canonical membership record.
 *
 * Throws NOT_FOUND when the organization does not exist, the user is not a
 * member, or the membership is disabled — callers cannot distinguish these,
 * so another tenant's existence is never revealed. Throws FORBIDDEN when a
 * required permission is missing.
 */
export async function getAuthorizedOrganization(
  { prisma }: Deps,
  params: { userId: string; organizationSlug: string; permission?: Permission },
): Promise<OrganizationContext> {
  const slug = organizationSlugSchema.safeParse(params.organizationSlug);
  if (!slug.success) throw new AppError("NOT_FOUND", "Organization not found.");

  const membership = await prisma.member.findFirst({
    where: {
      userId: params.userId,
      status: "ACTIVE",
      organization: { slug: slug.data, suspendedAt: null },
    },
    include: { organization: { select: { id: true, name: true, slug: true } } },
  });
  if (!membership || !isOrganizationRole(membership.role)) {
    throw new AppError("NOT_FOUND", "Organization not found.");
  }

  const context: OrganizationContext = {
    userId: params.userId,
    organization: membership.organization,
    membershipId: membership.id,
    role: membership.role,
    permissions: permissionsForRole(membership.role),
  };
  if (params.permission) requirePermission(context, params.permission);
  return context;
}

export function requirePermission(context: OrganizationContext, permission: Permission): void {
  if (!roleHasPermission(context.role, permission)) {
    throw new AppError("FORBIDDEN", "You do not have access to this resource.");
  }
}

export type MemberOption = { userId: string; name: string };

/** Active members of the caller's organization, for assignee/owner pickers. */
export async function listActiveMembers(
  { prisma }: Deps,
  context: OrganizationContext,
): Promise<MemberOption[]> {
  requirePermission(context, "member:read");
  const members = await prisma.member.findMany({
    where: { organizationId: context.organization.id, status: "ACTIVE" },
    select: { userId: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return members.map((member) => ({ userId: member.userId, name: member.user.name }));
}

export type MemberView = {
  userId: string;
  name: string;
  email: string | null;
  role: OrganizationRole;
};

/** Active members. Email addresses are only shown to roles that can invite (admins). */
export async function listMembers(
  { prisma }: Deps,
  context: OrganizationContext,
): Promise<MemberView[]> {
  requirePermission(context, "member:read");
  const showEmail = roleHasPermission(context.role, "member:invite");
  const members = await prisma.member.findMany({
    where: { organizationId: context.organization.id, status: "ACTIVE" },
    select: { role: true, userId: true, user: { select: { name: true, email: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return members.flatMap((member) =>
    isOrganizationRole(member.role)
      ? [
          {
            userId: member.userId,
            name: member.user.name,
            email: showEmail ? member.user.email : null,
            role: member.role,
          },
        ]
      : [],
  );
}
