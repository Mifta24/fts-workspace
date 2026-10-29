-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING');

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "ownerId" UUID NOT NULL,
    "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "consentUpdatedAt" TIMESTAMP(3),
    "erasedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "DealStage" NOT NULL DEFAULT 'LEAD',
    "amountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ownerId" UUID NOT NULL,
    "expectedCloseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "dealId" UUID,
    "type" "ActivityType" NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_contacts_organizationId_ownerId_idx" ON "crm_contacts"("organizationId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_contacts_id_organizationId_key" ON "crm_contacts"("id", "organizationId");

-- CreateIndex
CREATE INDEX "consent_events_organizationId_contactId_createdAt_idx" ON "consent_events"("organizationId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_deals_organizationId_stage_idx" ON "crm_deals"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "crm_deals_organizationId_ownerId_idx" ON "crm_deals"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "crm_deals_organizationId_contactId_idx" ON "crm_deals"("organizationId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deals_id_organizationId_key" ON "crm_deals"("id", "organizationId");

-- CreateIndex
CREATE INDEX "crm_activities_organizationId_contactId_occurredAt_idx" ON "crm_activities"("organizationId", "contactId", "occurredAt");

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_contactId_organizationId_fkey" FOREIGN KEY ("contactId", "organizationId") REFERENCES "crm_contacts"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_contactId_organizationId_fkey" FOREIGN KEY ("contactId", "organizationId") REFERENCES "crm_contacts"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contactId_organizationId_fkey" FOREIGN KEY ("contactId", "organizationId") REFERENCES "crm_contacts"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_dealId_organizationId_fkey" FOREIGN KEY ("dealId", "organizationId") REFERENCES "crm_deals"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain invariants enforced in the database.
CREATE UNIQUE INDEX "crm_contacts_org_email_unique" ON "crm_contacts"("organizationId", "email") WHERE "email" IS NOT NULL AND "erasedAt" IS NULL;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_email_lowercase" CHECK ("email" IS NULL OR "email" = lower("email"));
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_erased_has_no_pii" CHECK ("erasedAt" IS NULL OR ("email" IS NULL AND "phone" IS NULL AND "company" IS NULL));
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_amount_bounds" CHECK ("amountMinor" IS NULL OR ("amountMinor" >= 0 AND "amountMinor" <= 100000000000));
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_closed_matches_stage" CHECK (("stage" IN ('WON','LOST')) = ("closedAt" IS NOT NULL));
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_body_length" CHECK (length("body") <= 2000);

-- Consent history is append-only.
CREATE FUNCTION "consent_events_reject_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consent_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "consent_events_append_only" BEFORE UPDATE OR DELETE ON "consent_events"
  FOR EACH ROW EXECUTE FUNCTION "consent_events_reject_change"();

-- Rollback (manual): DROP TRIGGER "consent_events_append_only" ON "consent_events"; DROP FUNCTION "consent_events_reject_change"(); DROP TABLE "crm_activities"; DROP TABLE "crm_deals"; DROP TABLE "consent_events"; DROP TABLE "crm_contacts"; DROP TYPE "ActivityType"; DROP TYPE "DealStage"; DROP TYPE "ConsentStatus";
