-- A workspace owner can ask for the whole workspace to be deleted. This only records the request;
-- an operator removes the data after the waiting period.
ALTER TABLE "organizations" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "deletionRequestedBy" UUID;

-- Rollback (manual): ALTER TABLE "organizations" DROP COLUMN "deletionRequestedAt", DROP COLUMN "deletionRequestedBy";
