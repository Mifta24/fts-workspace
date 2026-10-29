import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { chunkText, documentIdSchema } from "@/features/knowledge/schemas/knowledge";
import type { ClaimedJob } from "@/server/jobs/queue";
import type { StoragePort } from "@/server/storage/storage";

/**
 * Worker-side indexing of one document. Runs outside any request, so it re-derives everything
 * from the database (tenant, file state) instead of trusting the job payload beyond the ids.
 * Errors carry no document text.
 */
export async function ingestDocument(
  deps: { prisma: PrismaClient; storage: StoragePort },
  job: ClaimedJob,
): Promise<void> {
  const documentId = documentIdSchema.safeParse(
    (job.payload as { documentId?: unknown })?.documentId,
  );
  if (!documentId.success) throw new Error("Invalid ingest payload");
  const { prisma, storage } = deps;

  // The organization comes from the job row, never from the payload.
  const document = await prisma.knowledgeDocument.findFirst({
    where: { id: documentId.data, organizationId: job.organizationId },
    include: { file: true },
  });
  if (!document) return; // removed from the knowledge base before the job ran
  const fail = async (message: string): Promise<never> => {
    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { status: "FAILED", error: message },
    });
    throw new Error(message);
  };

  if (document.file.status !== "READY") return fail("The file is no longer available.");
  if (!document.file.mimeType.startsWith("text/")) return fail("Only text files can be indexed.");
  const bytes = await storage.get(document.file.storageKey);
  if (!bytes) return fail("The stored file is missing.");
  if (createHash("sha256").update(bytes).digest("hex") !== document.file.sha256) {
    return fail("The stored file failed its integrity check.");
  }

  const { chunks, truncated } = chunkText(new TextDecoder("utf-8").decode(bytes));
  if (chunks.length === 0) return fail("The file has no text to index.");

  await prisma.$transaction(async (tx) => {
    await tx.documentChunk.deleteMany({
      where: { documentId: document.id, organizationId: job.organizationId },
    });
    await tx.documentChunk.createMany({
      data: chunks.map((content, ordinal) => ({
        organizationId: job.organizationId,
        documentId: document.id,
        ordinal,
        content,
      })),
    });
    await tx.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        status: "INDEXED",
        chunkCount: chunks.length,
        indexedAt: new Date(),
        error: truncated ? "Only the first part of the file was indexed." : null,
      },
    });
  });
}
