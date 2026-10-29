-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('TASK_PLAN', 'KNOWLEDGE_ANSWER');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('OK', 'ERROR');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "aiDailyTokenBudget" INTEGER NOT NULL DEFAULT 200000;

-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiUsageStatus" NOT NULL,
    "tokens" INTEGER NOT NULL,
    "tokensEstimated" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_events_organizationId_createdAt_idx" ON "ai_usage_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_events_organizationId_userId_createdAt_idx" ON "ai_usage_events"("organizationId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain invariants enforced in the database.
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_bounds" CHECK ("tokens" >= 0 AND "latencyMs" >= 0);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ai_budget_bounds" CHECK ("aiDailyTokenBudget" BETWEEN 0 AND 50000000);

-- Rollback (manual): DROP TABLE "ai_usage_events"; ALTER TABLE "organizations" DROP COLUMN "aiDailyTokenBudget"; DROP TYPE "AiUsageStatus"; DROP TYPE "AiFeature";
