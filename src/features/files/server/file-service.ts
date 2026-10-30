import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  fileIdSchema,
  MAX_FILE_BYTES,
  sanitizeFileName,
  uploadVisibilitySchema,
  verifyContent,
  visibilitySchema,
} from "@/features/files/schemas/file";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import type { StoragePort } from "@/server/storage/storage";
import { getEntitlements } from "@/features/billing/server/entitlements";
import { recordAuditEvent } from "@/server/services/audit";
import { assertActiveMember } from "@/server/services/tenant-refs";

type Deps = { prisma: PrismaClient; storage: StoragePort; correlationId?: string };
type DbDeps = Pick<Deps, "prisma">;

export type FileView = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  visibility: "PRIVATE" | "SHARED" | "ORGANIZATION";
  uploaderName: string | null;
  mine: boolean;
  createdAt: Date;
};

const notFound = () => new AppError("NOT_FOUND", "File not found.");

/**
 * The one definition of "who may read a file": uploader, or organization-wide visibility,
 * or an explicit share. Admins get no implicit access to other people's private files.
 * Knowledge search reuses this exact rule (see `fileAccessSql`).
 */
export function fileAccessWhere(context: OrganizationContext): Prisma.FileObjectWhereInput {
  return {
    organizationId: context.organization.id,
    status: "READY",
    OR: [
      { uploadedById: context.userId },
      { visibility: "ORGANIZATION" },
      { shares: { some: { userId: context.userId } } },
    ],
  };
}

const select = {
  id: true,
  name: true,
  mimeType: true,
  sizeBytes: true,
  visibility: true,
  uploadedById: true,
  createdAt: true,
} satisfies Prisma.FileObjectSelect;

async function toViews(
  prisma: PrismaClient,
  context: OrganizationContext,
  rows: Prisma.FileObjectGetPayload<{ select: typeof select }>[],
): Promise<FileView[]> {
  const uploaders = await prisma.user.findMany({
    where: {
      id: { in: [...new Set(rows.map((row) => row.uploadedById))] },
      memberships: { some: { organizationId: context.organization.id } },
    },
    select: { id: true, name: true },
  });
  const names = new Map(uploaders.map((user) => [user.id, user.name]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    visibility: row.visibility,
    uploaderName: names.get(row.uploadedById) ?? null,
    mine: row.uploadedById === context.userId,
    createdAt: row.createdAt,
  }));
}

export async function uploadFile(
  { prisma, storage, correlationId }: Deps,
  context: OrganizationContext,
  input: { name: string; mimeType: string; bytes: Uint8Array; visibility: unknown },
): Promise<FileView> {
  requirePermission(context, "file:upload");
  const visibility = uploadVisibilitySchema.safeParse(input.visibility);
  if (!visibility.success) throw new AppError("INVALID_INPUT", "Choose who can see the file.");
  if (input.bytes.length === 0) throw new AppError("INVALID_INPUT", "The file is empty.");
  if (input.bytes.length > MAX_FILE_BYTES) {
    throw new AppError("UNPROCESSABLE", "Files can be at most 10 MB.");
  }
  const mimeType = verifyContent(input.mimeType, input.bytes);
  if (!mimeType) throw new AppError("UNPROCESSABLE", "This file type is not allowed.");
  const organizationId = context.organization.id;

  const used = await prisma.fileObject.aggregate({
    where: { organizationId, status: "READY" },
    _sum: { sizeBytes: true },
  });
  const entitlements = await getEntitlements(prisma, organizationId);
  if ((used._sum.sizeBytes ?? 0) + input.bytes.length > entitlements.storageBytes) {
    throw new AppError(
      entitlements.plan === "UNMETERED" ? "UNPROCESSABLE" : "PLAN_LIMIT",
      "The storage quota of this workspace is used up.",
    );
  }

  const storageKey = `${organizationId}/${randomUUID()}`;
  await storage.put(storageKey, input.bytes);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.fileObject.create({
        data: {
          organizationId,
          uploadedById: context.userId,
          name: sanitizeFileName(input.name),
          mimeType,
          sizeBytes: input.bytes.length,
          sha256: createHash("sha256").update(input.bytes).digest("hex"),
          storageKey,
          visibility: visibility.data,
        },
        select,
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorId: context.userId,
        action: "file.uploaded",
        resourceType: "file",
        resourceId: created.id,
        metadata: { mimeType, sizeBytes: created.sizeBytes, visibility: visibility.data },
        correlationId,
      });
      return created;
    });
    return (await toViews(prisma, context, [row]))[0]!;
  } catch (error) {
    // Never leave bytes behind without a row that accounts for them.
    await storage.delete(storageKey).catch(() => {});
    throw error;
  }
}

export async function listFiles(
  { prisma }: DbDeps,
  context: OrganizationContext,
): Promise<FileView[]> {
  requirePermission(context, "file:read");
  const rows = await prisma.fileObject.findMany({
    where: fileAccessWhere(context),
    select,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  return toViews(prisma, context, rows);
}

/** A file the caller may read, else NOT_FOUND (indistinguishable from a missing or foreign one). */
export async function getFile(
  { prisma }: DbDeps,
  context: OrganizationContext,
  fileId: string,
): Promise<FileView> {
  requirePermission(context, "file:read");
  const id = fileIdSchema.safeParse(fileId);
  if (!id.success) throw notFound();
  const row = await prisma.fileObject.findFirst({
    where: { ...fileAccessWhere(context), id: id.data },
    select,
  });
  if (!row) throw notFound();
  return (await toViews(prisma, context, [row]))[0]!;
}

export async function readFileContent(
  { prisma, storage, correlationId }: Deps,
  context: OrganizationContext,
  fileId: string,
): Promise<{ file: FileView; bytes: Uint8Array }> {
  const file = await getFile({ prisma }, context, fileId);
  const row = await prisma.fileObject.findFirstOrThrow({
    where: { id: file.id, organizationId: context.organization.id },
    select: { storageKey: true, sha256: true },
  });
  const bytes = await storage.get(row.storageKey);
  if (!bytes) throw notFound();
  // Detect storage corruption or tampering before handing bytes to anyone.
  if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
    throw new AppError("UNPROCESSABLE", "The stored file failed its integrity check.");
  }
  void correlationId;
  return { file, bytes };
}

async function ownedFile(
  prisma: DbDeps["prisma"] | Prisma.TransactionClient,
  context: OrganizationContext,
  fileId: string,
) {
  const id = fileIdSchema.safeParse(fileId);
  if (!id.success) throw notFound();
  const row = await prisma.fileObject.findFirst({
    where: {
      id: id.data,
      organizationId: context.organization.id,
      status: "READY",
      uploadedById: context.userId,
    },
    select: { id: true, visibility: true },
  });
  if (!row) throw notFound();
  return row;
}

/** Only the uploader changes who can see a file. */
export async function setVisibility(
  { prisma, correlationId }: DbDeps & { correlationId?: string },
  context: OrganizationContext,
  fileId: string,
  rawVisibility: unknown,
): Promise<void> {
  requirePermission(context, "file:upload");
  const visibility = visibilitySchema.safeParse(rawVisibility);
  if (!visibility.success) throw new AppError("INVALID_INPUT", "Choose who can see the file.");
  await prisma.$transaction(async (tx) => {
    const file = await ownedFile(tx, context, fileId);
    await tx.fileObject.update({ where: { id: file.id }, data: { visibility: visibility.data } });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "file.visibility_changed",
      resourceType: "file",
      resourceId: file.id,
      metadata: { visibility: visibility.data },
      correlationId,
    });
  });
}

export async function shareFile(
  { prisma, correlationId }: DbDeps & { correlationId?: string },
  context: OrganizationContext,
  fileId: string,
  userId: string,
): Promise<void> {
  requirePermission(context, "file:upload");
  await prisma.$transaction(async (tx) => {
    const file = await ownedFile(tx, context, fileId);
    if (userId === context.userId)
      throw new AppError("INVALID_INPUT", "You already own this file.");
    await assertActiveMember(
      tx,
      context.organization.id,
      userId,
      "The user must be an active member.",
    );
    await tx.fileShare.upsert({
      where: { fileId_userId: { fileId: file.id, userId } },
      update: {},
      create: { organizationId: context.organization.id, fileId: file.id, userId },
    });
    if (file.visibility === "PRIVATE") {
      await tx.fileObject.update({ where: { id: file.id }, data: { visibility: "SHARED" } });
    }
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "file.shared",
      resourceType: "file",
      resourceId: file.id,
      metadata: { userId },
      correlationId,
    });
  });
}

export async function unshareFile(
  { prisma, correlationId }: DbDeps & { correlationId?: string },
  context: OrganizationContext,
  fileId: string,
  userId: string,
): Promise<void> {
  requirePermission(context, "file:upload");
  await prisma.$transaction(async (tx) => {
    const file = await ownedFile(tx, context, fileId);
    await tx.fileShare.deleteMany({
      where: { fileId: file.id, userId, organizationId: context.organization.id },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "file.unshared",
      resourceType: "file",
      resourceId: file.id,
      metadata: { userId },
      correlationId,
    });
  });
}

export async function listShares(
  { prisma }: DbDeps,
  context: OrganizationContext,
  fileId: string,
): Promise<{ userId: string; name: string }[]> {
  const file = await ownedFile(prisma, context, fileId);
  const shares = await prisma.fileShare.findMany({
    where: { fileId: file.id, organizationId: context.organization.id },
    select: { userId: true },
  });
  const users = await prisma.user.findMany({
    where: {
      id: { in: shares.map((share) => share.userId) },
      memberships: { some: { organizationId: context.organization.id } },
    },
    select: { id: true, name: true },
  });
  return users.map((user) => ({ userId: user.id, name: user.name }));
}

/**
 * Uploaders delete their own files; OWNER/ADMIN (`file:delete-any`) may remove any file in the
 * organization without being able to read it. The bytes are removed, the metadata row stays
 * (status DELETED) so the audit trail still resolves.
 */
export async function deleteFile(
  { prisma, storage, correlationId }: Deps,
  context: OrganizationContext,
  fileId: string,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(context, "file:read");
  const id = fileIdSchema.safeParse(fileId);
  if (!id.success) throw notFound();
  const organizationId = context.organization.id;

  const storageKey = await prisma.$transaction(async (tx) => {
    const file = await tx.fileObject.findFirst({
      where: { id: id.data, organizationId, status: "READY" },
      select: { id: true, uploadedById: true, storageKey: true, visibility: true },
    });
    if (!file) throw notFound();
    const isOwner = file.uploadedById === context.userId;
    const canModerate = context.permissions.includes("file:delete-any");
    if (!isOwner && !canModerate) throw notFound();
    await tx.fileObject.update({
      where: { id: file.id },
      data: { status: "DELETED", deletedAt: now },
    });
    // Derived search data goes with the file (it could not match anyway: the file is no longer READY).
    await tx.knowledgeDocument.deleteMany({ where: { fileId: file.id, organizationId } });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: "file.deleted",
      resourceType: "file",
      resourceId: file.id,
      metadata: { moderated: !isOwner },
      correlationId,
    });
    return file.storageKey;
  });
  await storage.delete(storageKey).catch(() => {});
}
