-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RECEIVED';

-- CreateEnum
CREATE TYPE "BookingPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateTable
CREATE TABLE "booking_pages" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "minNoticeHours" INTEGER NOT NULL DEFAULT 4,
    "maxDaysAhead" INTEGER NOT NULL DEFAULT 30,
    "consentText" TEXT NOT NULL,
    "status" "BookingPageStatus" NOT NULL DEFAULT 'DRAFT',
    "publicToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_pages_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "bookingPageId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "booking_pages_publicToken_key" ON "booking_pages"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "booking_pages_id_organizationId_key" ON "booking_pages"("id", "organizationId");

-- CreateIndex
CREATE INDEX "booking_pages_organizationId_ownerId_idx" ON "booking_pages"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "appointments_bookingPageId_createdAt_idx" ON "appointments"("bookingPageId", "createdAt");

-- AddForeignKey
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_bookingPageId_organizationId_fkey" FOREIGN KEY ("bookingPageId", "organizationId") REFERENCES "booking_pages"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants enforced in the database.
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_duration_valid" CHECK ("durationMinutes" BETWEEN 15 AND 240);
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_hours_valid" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute" AND "endMinute" - "startMinute" >= "durationMinutes");
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_weekdays_valid" CHECK (cardinality("weekdays") BETWEEN 1 AND 7 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7]);
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_horizon_valid" CHECK ("minNoticeHours" BETWEEN 0 AND 720 AND "maxDaysAhead" BETWEEN 1 AND 90);
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_token_shape" CHECK ("publicToken" ~ '^[A-Za-z0-9_-]{22,64}$');
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_published_has_consent" CHECK ("status" = 'DRAFT' OR length("consentText") >= 10);

-- Rollback (manual): ALTER TABLE "appointments" DROP COLUMN "bookingPageId"; DROP TABLE "booking_pages"; DROP TYPE "BookingPageStatus"; (the enum value added to "NotificationType" cannot be dropped without recreating the type.)
