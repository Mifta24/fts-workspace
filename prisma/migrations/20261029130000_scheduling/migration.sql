-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendeeResponse" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_INVITED';
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_CANCELLED';

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "organizerId" UUID NOT NULL,
    "contactId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_attendees" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "response" "AttendeeResponse" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_organizationId_startsAt_idx" ON "appointments"("organizationId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_id_organizationId_key" ON "appointments"("id", "organizationId");

-- CreateIndex
CREATE INDEX "appointment_attendees_organizationId_userId_idx" ON "appointment_attendees"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_attendees_appointmentId_userId_key" ON "appointment_attendees"("appointmentId", "userId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contactId_organizationId_fkey" FOREIGN KEY ("contactId", "organizationId") REFERENCES "crm_contacts"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_attendees" ADD CONSTRAINT "appointment_attendees_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_attendees" ADD CONSTRAINT "appointment_attendees_appointmentId_organizationId_fkey" FOREIGN KEY ("appointmentId", "organizationId") REFERENCES "appointments"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Domain invariants enforced in the database.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_window_valid" CHECK ("endsAt" > "startsAt" AND "endsAt" - "startsAt" <= interval '24 hours');

-- Rollback (manual): DROP TABLE "appointment_attendees"; DROP TABLE "appointments"; DROP TYPE "AttendeeResponse"; DROP TYPE "AppointmentStatus"; (enum values added to "NotificationType" cannot be dropped without recreating the type.)
