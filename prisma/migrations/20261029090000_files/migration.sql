-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PRIVATE', 'SHARED', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('READY', 'DELETED');

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "FileStatus" NOT NULL DEFAULT 'READY',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_shares" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_storageKey_key" ON "files"("storageKey");

-- CreateIndex
CREATE INDEX "files_organizationId_status_createdAt_idx" ON "files"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "files_organizationId_uploadedById_idx" ON "files"("organizationId", "uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "files_id_organizationId_key" ON "files"("id", "organizationId");

-- CreateIndex
CREATE INDEX "file_shares_organizationId_userId_idx" ON "file_shares"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "file_shares_fileId_userId_key" ON "file_shares"("fileId", "userId");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_fileId_organizationId_fkey" FOREIGN KEY ("fileId", "organizationId") REFERENCES "files"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Domain invariants enforced in the database.
ALTER TABLE "files" ADD CONSTRAINT "files_size_bounds" CHECK ("sizeBytes" >= 0 AND "sizeBytes" <= 10485760);
ALTER TABLE "files" ADD CONSTRAINT "files_deleted_consistent" CHECK (("status" = 'DELETED') = ("deletedAt" IS NOT NULL));
ALTER TABLE "files" ADD CONSTRAINT "files_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- Rollback (manual): DROP TABLE "file_shares"; DROP TABLE "files"; DROP TYPE "FileStatus"; DROP TYPE "FileVisibility";
