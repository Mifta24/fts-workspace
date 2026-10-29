-- CreateEnum
CREATE TYPE "AiPlanStatus" AS ENUM ('DRAFT', 'APPLIED', 'DISCARDED');

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_task_plans" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "objective" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "status" "AiPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_task_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestones_organizationId_goalId_idx" ON "milestones"("organizationId", "goalId");

-- CreateIndex
CREATE INDEX "ai_task_plans_organizationId_goalId_idx" ON "ai_task_plans"("organizationId", "goalId");

-- CreateIndex
CREATE INDEX "ai_task_plans_organizationId_requestedById_createdAt_idx" ON "ai_task_plans"("organizationId", "requestedById", "createdAt");

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_goalId_organizationId_fkey" FOREIGN KEY ("goalId", "organizationId") REFERENCES "goals"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_task_plans" ADD CONSTRAINT "ai_task_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_task_plans" ADD CONSTRAINT "ai_task_plans_goalId_organizationId_fkey" FOREIGN KEY ("goalId", "organizationId") REFERENCES "goals"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Domain invariants enforced in the database.
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_title_not_blank" CHECK (length(btrim("title")) > 0);
ALTER TABLE "ai_task_plans" ADD CONSTRAINT "ai_task_plans_applied_consistent" CHECK (("status" = 'APPLIED') = ("appliedAt" IS NOT NULL));

-- Rollback (manual): DROP TABLE "ai_task_plans"; DROP TABLE "milestones"; DROP TYPE "AiPlanStatus";
