-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateTable
CREATE TABLE "forms" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "consentText" TEXT,
    "createsContact" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" UUID NOT NULL,
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "publicToken" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "formId" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "contactId" UUID,
    "erasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forms_publicToken_key" ON "forms"("publicToken");

-- CreateIndex
CREATE INDEX "forms_organizationId_status_idx" ON "forms"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "forms_id_organizationId_key" ON "forms"("id", "organizationId");

-- CreateIndex
CREATE INDEX "form_submissions_organizationId_formId_createdAt_idx" ON "form_submissions"("organizationId", "formId", "createdAt");

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_formId_organizationId_fkey" FOREIGN KEY ("formId", "organizationId") REFERENCES "forms"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_contactId_organizationId_fkey" FOREIGN KEY ("contactId", "organizationId") REFERENCES "crm_contacts"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain invariants enforced in the database.
ALTER TABLE "forms" ADD CONSTRAINT "forms_token_shape" CHECK ("publicToken" ~ '^[A-Za-z0-9_-]{22,64}$');
ALTER TABLE "forms" ADD CONSTRAINT "forms_contact_needs_consent" CHECK (NOT "createsContact" OR ("consentText" IS NOT NULL AND length(btrim("consentText")) > 0));
ALTER TABLE "forms" ADD CONSTRAINT "forms_fields_is_array" CHECK (jsonb_typeof("fields") = 'array' AND jsonb_array_length("fields") BETWEEN 1 AND 20);
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_erased_empty" CHECK ("erasedAt" IS NULL OR "answers" = '{}'::jsonb);

-- Rollback (manual): DROP TABLE "form_submissions"; DROP TABLE "forms"; DROP TYPE "FormStatus";
