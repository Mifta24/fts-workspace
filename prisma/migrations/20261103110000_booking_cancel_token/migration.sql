-- A booking visitor can cancel through a secret link in the confirmation email. Only the hash is kept.
ALTER TABLE "appointments" ADD COLUMN "cancelTokenHash" TEXT;
CREATE UNIQUE INDEX "appointments_cancelTokenHash_key" ON "appointments"("cancelTokenHash");

-- Rollback (manual): DROP INDEX "appointments_cancelTokenHash_key"; ALTER TABLE "appointments" DROP COLUMN "cancelTokenHash";
