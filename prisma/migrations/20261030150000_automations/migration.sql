-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'FORM_SUBMITTED';

-- CreateEnum
CREATE TYPE "AutomationRuleKey" AS ENUM ('FORM_SUBMITTED_NOTIFY', 'FORM_SUBMITTED_TASK', 'BOOKING_RECEIVED_NOTE');

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ruleKey" "AutomationRuleKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ruleKey" "AutomationRuleKey" NOT NULL,
    "subjectId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_organizationId_ruleKey_key" ON "automation_rules"("organizationId", "ruleKey");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_organizationId_ruleKey_subjectId_key" ON "automation_runs"("organizationId", "ruleKey", "subjectId");

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rollback (manual): DROP TABLE "automation_runs"; DROP TABLE "automation_rules"; DROP TYPE "AutomationRuleKey";
-- (a value added to "NotificationType" cannot be removed without recreating the type.)
