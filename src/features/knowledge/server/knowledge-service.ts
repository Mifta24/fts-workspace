import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { fileIdSchema, TEXT_MIME_TYPES } from "@/features/files/schemas/file";
import { fileAccessWhere } from "@/features/files/server/file-service";
import {
  INGEST_JOB,
  searchQuerySchema,
  SEARCH_LIMIT,
  SNIPPET_CHARS,
} from "@/features/knowledge/schemas/knowledge";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { enqueueJob } from "@/server/jobs/queue";
import { recordAuditEvent } from "@/server/services/audit";

type Deps = { prisma: PrismaClient; correlationId?: string };

export type DocumentView = {
  id: string;
  fileId: string;
  fileName: string;
  status: "PENDING" | "INDEXED" | "FAILED";
  chunkCount: number;
  error: string | null;
  mine: boolean;
};

export type SearchHit = {
  chunkId: string;
  fileId: string;
  fileName: string;
  snippet: string;
  rank: number;
};

const notFound = () => new AppError("NOT_FOUND", "File not found.");

/** Adds one of your own text files to the knowledge base (indexing runs in the worker). */
export async function requestIndexing(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  fileId: string,
): Promise<void> {
  requirePermission(context, "knowledge:manage");
  const id = fileIdSchema.safeParse(fileId);
  if (!id.success) throw notFound();
  const organizationId = context.organization.id;

  await prisma.$transaction(async (tx) => {
    const file = await tx.fileObject.findFirst({
      where: { id: id.data, organizationId, status: "READY", uploadedById: context.userId },
      select: { id: true, mimeType: true },
    });
    if (!file) throw notFound();
    if (!(TEXT_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
      throw new AppError("UNPROCESSABLE", "Only text, Markdown and CSV files can be indexed.");
    }
    const document = await tx.knowledgeDocument.upsert({
      where: { fileId: file.id },
      update: { status: "PENDING", error: null, indexedAt: null },
      create: { organizationId, fileId: file.id, createdById: context.userId },
      select: { id: true },
    });
    const dedupeKey = `ingest:${document.id}`;
    // A finished (or failed) earlier job must not block a deliberate re-index.
    await tx.job.deleteMany({
      where: { organizationId, dedupeKey, status: { in: ["DONE", "FAILED"] } },
    });
    await enqueueJob(tx, {
      organizationId,
      type: INGEST_JOB,
      payload: { documentId: document.id },
      dedupeKey,
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: "knowledge.index_requested",
      resourceType: "file",
      resourceId: file.id,
      correlationId,
    });
  });
}

export async function removeFromKnowledge(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  fileId: string,
): Promise<void> {
  requirePermission(context, "knowledge:manage");
  const id = fileIdSchema.safeParse(fileId);
  if (!id.success) throw notFound();
  await prisma.$transaction(async (tx) => {
    const result = await tx.knowledgeDocument.deleteMany({
      where: {
        fileId: id.data,
        organizationId: context.organization.id,
        file: { uploadedById: context.userId },
      },
    });
    if (result.count === 0) throw notFound();
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "knowledge.removed",
      resourceType: "file",
      resourceId: id.data,
      correlationId,
    });
  });
}

/** Documents whose file the caller may read. */
export async function listDocuments(
  { prisma }: Deps,
  context: OrganizationContext,
): Promise<DocumentView[]> {
  requirePermission(context, "knowledge:read");
  const rows = await prisma.knowledgeDocument.findMany({
    where: { organizationId: context.organization.id, file: fileAccessWhere(context) },
    include: { file: { select: { name: true, uploadedById: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    fileId: row.fileId,
    fileName: row.file.name,
    status: row.status,
    chunkCount: row.chunkCount,
    error: row.error,
    mine: row.file.uploadedById === context.userId,
  }));
}

/**
 * Keyword search over indexed passages. The access rule is applied **inside the query**, so
 * passages of files the caller cannot read are never selected, ranked or returned (and thus can
 * never reach a prompt). It mirrors `fileAccessWhere`; the tests keep the two in step.
 */
export async function searchKnowledge(
  { prisma }: Deps,
  context: OrganizationContext,
  rawQuery: unknown,
  limit: number = SEARCH_LIMIT,
): Promise<SearchHit[]> {
  requirePermission(context, "knowledge:read");
  const query = searchQuerySchema.safeParse(rawQuery);
  if (!query.success)
    throw new AppError("INVALID_INPUT", "Type at least two characters to search.");
  const organizationId = context.organization.id;
  const userId = context.userId;
  const take = Math.min(Math.max(1, limit), 20);

  const rows = await prisma.$queryRaw<
    { id: string; fileId: string; name: string; content: string; rank: number }[]
  >`
    SELECT c."id", d."fileId", f."name", c."content", ts_rank(c."tsv", q) AS "rank"
    FROM "document_chunks" c
    JOIN "knowledge_documents" d ON d."id" = c."documentId" AND d."organizationId" = c."organizationId"
    JOIN "files" f ON f."id" = d."fileId" AND f."organizationId" = d."organizationId"
    CROSS JOIN websearch_to_tsquery('simple', ${query.data}) q
    WHERE c."organizationId" = ${organizationId}::uuid
      AND d."status" = 'INDEXED'
      AND f."status" = 'READY'
      AND c."tsv" @@ q
      AND (
        f."uploadedById" = ${userId}::uuid
        OR f."visibility" = 'ORGANIZATION'
        OR EXISTS (
          SELECT 1 FROM "file_shares" s
          WHERE s."fileId" = f."id" AND s."organizationId" = f."organizationId" AND s."userId" = ${userId}::uuid
        )
      )
    ORDER BY "rank" DESC, c."id"
    LIMIT ${take}`;

  return rows.map((row) => ({
    chunkId: row.id,
    fileId: row.fileId,
    fileName: row.name,
    snippet:
      row.content.length > SNIPPET_CHARS ? `${row.content.slice(0, SNIPPET_CHARS)}…` : row.content,
    rank: Number(row.rank),
  }));
}
