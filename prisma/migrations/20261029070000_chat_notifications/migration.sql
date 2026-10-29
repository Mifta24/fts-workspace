-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('CHANNEL', 'DM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TASK_ASSIGNED', 'TASK_COMMENTED', 'DIRECT_MESSAGE');

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "ChannelType" NOT NULL DEFAULT 'CHANNEL',
    "name" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "dmKey" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_members" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "actorId" UUID,
    "resourceType" TEXT NOT NULL,
    "resourceId" UUID NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channels_id_organizationId_key" ON "channels"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "channels_organizationId_name_key" ON "channels"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "channels_organizationId_dmKey_key" ON "channels"("organizationId", "dmKey");

-- CreateIndex
CREATE INDEX "channel_members_organizationId_userId_idx" ON "channel_members"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_members_channelId_userId_key" ON "channel_members"("channelId", "userId");

-- CreateIndex
CREATE INDEX "messages_organizationId_channelId_createdAt_id_idx" ON "messages"("organizationId", "channelId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "messages_organizationId_authorId_createdAt_idx" ON "messages"("organizationId", "authorId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_organizationId_userId_readAt_createdAt_idx" ON "notifications"("organizationId", "userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channelId_organizationId_fkey" FOREIGN KEY ("channelId", "organizationId") REFERENCES "channels"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_channelId_organizationId_fkey" FOREIGN KEY ("channelId", "organizationId") REFERENCES "channels"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Domain invariants enforced in the database.
ALTER TABLE "channels" ADD CONSTRAINT "channels_shape" CHECK (
  ("type" = 'CHANNEL' AND "name" IS NOT NULL AND "dmKey" IS NULL)
  OR ("type" = 'DM' AND "name" IS NULL AND "dmKey" IS NOT NULL AND "isPrivate")
);
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_length" CHECK (length("body") <= 4000);
ALTER TABLE "messages" ADD CONSTRAINT "messages_deleted_blank" CHECK ("deletedAt" IS NULL OR "body" = '');

-- Rollback (manual): DROP TABLE "notifications"; DROP TABLE "messages"; DROP TABLE "channel_members"; DROP TABLE "channels"; DROP TYPE "NotificationType"; DROP TYPE "ChannelType";
