-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_REMINDER';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "timeZone" TEXT;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "reminderMinutes" INTEGER NOT NULL DEFAULT 15;

-- Domain invariant enforced in the database.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_reminder_valid" CHECK ("reminderMinutes" BETWEEN 0 AND 10080);

-- Rollback (manual): ALTER TABLE "appointments" DROP CONSTRAINT "appointments_reminder_valid"; ALTER TABLE "appointments" DROP COLUMN "reminderMinutes"; ALTER TABLE "users" DROP COLUMN "timeZone"; (the enum value added to "NotificationType" cannot be dropped without recreating the type.)
