-- CreateTable
CREATE TABLE "calendar_feeds" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "calendar_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_tokenHash_key" ON "calendar_feeds"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_organizationId_userId_key" ON "calendar_feeds"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only a SHA-256 hex digest is ever stored.
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_token_is_hash" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

-- Rollback (manual): DROP TABLE "calendar_feeds";
