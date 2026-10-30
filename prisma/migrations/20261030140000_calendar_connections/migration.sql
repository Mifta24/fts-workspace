-- CreateEnum
CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "CalendarConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_RECONNECT');

-- CreateTable
CREATE TABLE "calendar_connections" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "CalendarProvider" NOT NULL,
    "status" "CalendarConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "refreshTokenSealed" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connections_organizationId_userId_provider_key" ON "calendar_connections"("organizationId", "userId", "provider");

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "members"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only sealed tokens are ever stored: a plaintext token cannot be written by mistake.
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_token_is_sealed" CHECK ("refreshTokenSealed" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');

-- Rollback (manual): DROP TABLE "calendar_connections"; DROP TYPE "CalendarConnectionStatus"; DROP TYPE "CalendarProvider";
