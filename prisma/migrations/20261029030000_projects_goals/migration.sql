-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProgressMode" AS ENUM ('TASK_BASED', 'MILESTONE_BASED', 'NUMERIC_KPI', 'MANUAL');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "parentGoalId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "progressMode" "ProgressMode" NOT NULL DEFAULT 'MANUAL',
    "manualProgress" INTEGER,
    "targetValue" DECIMAL(18,4),
    "currentValue" DECIMAL(18,4),
    "ownerId" UUID NOT NULL,
    "dueAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_organizationId_status_idx" ON "projects"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_organizationId_key" ON "projects"("id", "organizationId");

-- CreateIndex
CREATE INDEX "goals_organizationId_parentGoalId_idx" ON "goals"("organizationId", "parentGoalId");

-- CreateIndex
CREATE INDEX "goals_organizationId_projectId_idx" ON "goals"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "goals_organizationId_ownerId_status_idx" ON "goals"("organizationId", "ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "goals_id_organizationId_key" ON "goals"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "projects"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_parentGoalId_organizationId_fkey" FOREIGN KEY ("parentGoalId", "organizationId") REFERENCES "goals"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain invariants enforced in the database (defense in depth; the service validates first).
ALTER TABLE "goals" ADD CONSTRAINT "goals_manual_progress_range" CHECK ("manualProgress" IS NULL OR ("manualProgress" >= 0 AND "manualProgress" <= 100));
ALTER TABLE "goals" ADD CONSTRAINT "goals_not_own_parent" CHECK ("parentGoalId" IS NULL OR "parentGoalId" <> "id");
ALTER TABLE "goals" ADD CONSTRAINT "goals_kpi_values_valid" CHECK ("targetValue" IS NULL OR "targetValue" > 0);
ALTER TABLE "goals" ADD CONSTRAINT "goals_current_value_valid" CHECK ("currentValue" IS NULL OR "currentValue" >= 0);

-- Rollback (manual): DROP TABLE "goals"; DROP TABLE "projects"; DROP TYPE "ProgressMode"; DROP TYPE "GoalStatus"; DROP TYPE "ProjectStatus";
