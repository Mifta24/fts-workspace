import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { sendEmail } from "@/lib/email";
import { AppError } from "@/lib/errors";
import {
  createInvitationSchema,
  invitationIdSchema,
  invitationTokenSchema,
} from "@/features/organizations/schemas/organization";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { recordAuditEvent } from "@/server/services/audit";

type Deps = { prisma: PrismaClient; correlationId?: string };

export const INVITATION_TTL_MS = 7 * 24 * 3_600_000;
export const MAX_PENDING_INVITATIONS = 100;

export type InvitationView = {
  id: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "MEMBER" | "VIEWER";
  expiresAt: Date;
  expired: boolean;
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const invalid = () => new AppError("NOT_FOUND", "Invitation not found or expired.");

/**
 * Creates a single-use invitation and emails the link. The token is never returned
 * or stored in clear text; only its hash is persisted.
 */
export async function createInvitation(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
  options: { baseUrl: string; locale: string; now?: Date },
): Promise<InvitationView> {
  requirePermission(context, "member:invite");
  const parsed = createInvitationSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Enter a valid email and role.");
  const { email, role } = parsed.data;
  const organizationId = context.organization.id;
  const now = options.now ?? new Date();

  const token = randomBytes(32).toString("base64url");
  let invitation: InvitationView;
  try {
    invitation = await prisma.$transaction(async (tx) => {
      const existingMember = await tx.member.findFirst({
        where: { organizationId, user: { email } },
        select: { id: true },
      });
      if (existingMember) throw new AppError("CONFLICT", "This person is already a member.");

      const pending = await tx.invitation.count({
        where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      });
      if (pending >= MAX_PENDING_INVITATIONS) {
        throw new AppError("UNPROCESSABLE", "Too many pending invitations. Revoke some first.");
      }
      // An expired invitation must not block a fresh one for the same email.
      await tx.invitation.updateMany({
        where: {
          organizationId,
          email,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { lte: now },
        },
        data: { revokedAt: now },
      });
      const created = await tx.invitation.create({
        data: {
          organizationId,
          email,
          role,
          tokenHash: hashToken(token),
          invitedById: context.userId,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        },
        select: { id: true, email: true, role: true, expiresAt: true },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorId: context.userId,
        action: "invitation.created",
        resourceType: "invitation",
        resourceId: created.id,
        metadata: { role },
        correlationId,
      });
      return toView({ ...created, role: role }, now);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "This email already has a pending invitation.");
    }
    throw error;
  }

  await sendEmail({
    to: email,
    subject: `You are invited to ${context.organization.name} on FTS Workspace`,
    text: `You have been invited to join "${context.organization.name}" as ${role.toLowerCase()}.\nSign in with ${email} and open this link within 7 days:\n${options.baseUrl.replace(/\/+$/, "")}/${options.locale}/invite/${token}`,
  });
  return invitation;
}

export async function listPendingInvitations(
  { prisma }: Deps,
  context: OrganizationContext,
  now: Date = new Date(),
): Promise<InvitationView[]> {
  requirePermission(context, "member:invite");
  const rows = await prisma.invitation.findMany({
    where: { organizationId: context.organization.id, acceptedAt: null, revokedAt: null },
    select: { id: true, email: true, role: true, expiresAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 200,
  });
  return rows.map((row) => toView(row, now));
}

export async function revokeInvitation(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  invitationId: string,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(context, "member:invite");
  const id = invitationIdSchema.safeParse(invitationId);
  if (!id.success) throw invalid();
  await prisma.$transaction(async (tx) => {
    const result = await tx.invitation.updateMany({
      where: {
        id: id.data,
        organizationId: context.organization.id,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    if (result.count === 0) throw invalid();
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "invitation.revoked",
      resourceType: "invitation",
      resourceId: id.data,
      correlationId,
    });
  });
}

export type InvitationPreview = {
  organizationName: string;
  role: InvitationView["role"];
  /** Masked, e.g. "a***@example.com": enough to recognize, not to harvest. */
  maskedEmail: string;
};

/** Public lookup by token. Unknown, used, revoked and expired tokens are indistinguishable. */
export async function previewInvitation(
  { prisma }: Deps,
  rawToken: string,
  now: Date = new Date(),
): Promise<InvitationPreview> {
  const row = await findPending(prisma, rawToken, now);
  return {
    organizationName: row.organization.name,
    role: row.role as InvitationView["role"],
    maskedEmail: maskEmail(row.email),
  };
}

/**
 * Accepts an invitation for the signed-in user. The user must have a verified email
 * equal to the invited one; the invitation is claimed with a conditional update, so
 * concurrent or repeated attempts can create at most one membership.
 */
export async function acceptInvitation(
  { prisma, correlationId }: Deps,
  user: { id: string; email: string; emailVerified: boolean },
  rawToken: string,
  now: Date = new Date(),
): Promise<{ organizationSlug: string }> {
  const invitation = await findPending(prisma, rawToken, now);
  if (!user.emailVerified || user.email.toLowerCase() !== invitation.email) {
    throw new AppError("FORBIDDEN", "This invitation was sent to a different email address.");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.member.findFirst({
      where: { organizationId: invitation.organizationId, userId: user.id },
      select: { id: true },
    });
    // A disabled member is not silently re-enabled by an invitation.
    if (existing)
      throw new AppError("CONFLICT", "You already have a membership in this workspace.");

    const claimed = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now, acceptedById: user.id },
    });
    if (claimed.count === 0) throw invalid();

    await tx.member.create({
      data: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role },
    });
    await recordAuditEvent(tx, {
      organizationId: invitation.organizationId,
      actorId: user.id,
      action: "member.joined",
      resourceType: "member",
      resourceId: user.id,
      metadata: {
        role: invitation.role,
        invitationId: invitation.id,
        invitedById: invitation.invitedById,
      },
      correlationId,
    });
    return { organizationSlug: invitation.organization.slug };
  });
}

async function findPending(prisma: PrismaClient, rawToken: string, now: Date) {
  const token = invitationTokenSchema.safeParse(rawToken);
  if (!token.success) throw invalid();
  const row = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token.data) },
    include: { organization: { select: { name: true, slug: true } } },
  });
  if (!row || row.acceptedAt || row.revokedAt || row.expiresAt <= now) throw invalid();
  return row;
}

function toView(
  row: { id: string; email: string; role: string; expiresAt: Date },
  now: Date,
): InvitationView {
  return {
    id: row.id,
    email: row.email,
    role: row.role as InvitationView["role"],
    expiresAt: row.expiresAt,
    expired: row.expiresAt <= now,
  };
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
