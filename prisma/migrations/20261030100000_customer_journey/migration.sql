-- CreateEnum
CREATE TYPE "JourneyStage" AS ENUM ('LEAD', 'PROSPECT', 'CUSTOMER', 'LAPSED');

-- CreateEnum
CREATE TYPE "StageChangeReason" AS ENUM ('CREATED', 'MANUAL', 'DEAL_WON');

-- AlterTable
ALTER TABLE "crm_contacts" ADD COLUMN "journeyStage" "JourneyStage" NOT NULL DEFAULT 'LEAD';

-- CreateTable
CREATE TABLE "contact_stage_changes" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "fromStage" "JourneyStage",
    "toStage" "JourneyStage" NOT NULL,
    "reason" "StageChangeReason" NOT NULL,
    "changedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_stage_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_stage_changes_organizationId_contactId_createdAt_idx" ON "contact_stage_changes"("organizationId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "contact_stage_changes_organizationId_toStage_createdAt_idx" ON "contact_stage_changes"("organizationId", "toStage", "createdAt");

-- AddForeignKey
ALTER TABLE "contact_stage_changes" ADD CONSTRAINT "contact_stage_changes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_stage_changes" ADD CONSTRAINT "contact_stage_changes_contactId_organizationId_fkey" FOREIGN KEY ("contactId", "organizationId") REFERENCES "crm_contacts"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contacts that already have a won deal are customers. Their earlier history is not reconstructed.
UPDATE "crm_contacts" SET "journeyStage" = 'CUSTOMER'
WHERE EXISTS (
  SELECT 1 FROM "crm_deals"
  WHERE "crm_deals"."contactId" = "crm_contacts"."id"
    AND "crm_deals"."organizationId" = "crm_contacts"."organizationId"
    AND "crm_deals"."stage" = 'WON'
);

-- The first entry has no previous stage; every other entry must change the stage.
ALTER TABLE "contact_stage_changes" ADD CONSTRAINT "contact_stage_changes_is_a_change" CHECK (("reason" = 'CREATED') = ("fromStage" IS NULL) AND ("fromStage" IS NULL OR "fromStage" <> "toStage"));

-- The journey history is append-only.
CREATE FUNCTION "contact_stage_changes_reject_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'contact_stage_changes is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "contact_stage_changes_append_only" BEFORE UPDATE OR DELETE ON "contact_stage_changes"
  FOR EACH ROW EXECUTE FUNCTION "contact_stage_changes_reject_change"();

-- Rollback (manual): DROP TRIGGER "contact_stage_changes_append_only" ON "contact_stage_changes"; DROP FUNCTION "contact_stage_changes_reject_change"(); DROP TABLE "contact_stage_changes"; ALTER TABLE "crm_contacts" DROP COLUMN "journeyStage"; DROP TYPE "StageChangeReason"; DROP TYPE "JourneyStage";
