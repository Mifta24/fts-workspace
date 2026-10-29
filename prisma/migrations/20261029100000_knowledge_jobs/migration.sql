-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'INDEXED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "indexedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_documents_organizationId_status_idx" ON "knowledge_documents"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_id_organizationId_key" ON "knowledge_documents"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_fileId_key" ON "knowledge_documents"("fileId");

-- CreateIndex
CREATE INDEX "document_chunks_organizationId_documentId_idx" ON "document_chunks"("organizationId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_documentId_ordinal_key" ON "document_chunks"("documentId", "ordinal");

-- CreateIndex
CREATE INDEX "jobs_status_runAt_idx" ON "jobs"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_organizationId_dedupeKey_key" ON "jobs"("organizationId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_fileId_organizationId_fkey" FOREIGN KEY ("fileId", "organizationId") REFERENCES "files"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_organizationId_fkey" FOREIGN KEY ("documentId", "organizationId") REFERENCES "knowledge_documents"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Full-text index over chunks (language-neutral 'simple' configuration: no stemming, so Japanese
-- is only matched on whitespace-separated tokens until a proper tokenizer or embeddings are added).
CREATE INDEX "document_chunks_tsv_idx" ON "document_chunks" USING GIN ("tsv");

-- Domain invariants enforced in the database.
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_content_bounds" CHECK (length("content") BETWEEN 1 AND 4000);
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_indexed_consistent" CHECK (("status" = 'INDEXED') = ("indexedAt" IS NOT NULL));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_attempts_bounds" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 10);

-- Rollback (manual): DROP TABLE "jobs"; DROP TABLE "document_chunks"; DROP TABLE "knowledge_documents"; DROP TYPE "JobStatus"; DROP TYPE "DocumentStatus";
