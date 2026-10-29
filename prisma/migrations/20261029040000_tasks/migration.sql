-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "goalId" UUID,
    "parentTaskId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" UUID,
    "createdById" UUID NOT NULL,
    "startsAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_organizationId_status_dueAt_idx" ON "tasks"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_organizationId_assigneeId_status_idx" ON "tasks"("organizationId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "tasks_organizationId_goalId_idx" ON "tasks"("organizationId", "goalId");

-- CreateIndex
CREATE INDEX "tasks_organizationId_parentTaskId_idx" ON "tasks"("organizationId", "parentTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_organizationId_key" ON "tasks"("id", "organizationId");

-- CreateIndex
CREATE INDEX "task_comments_organizationId_taskId_createdAt_idx" ON "task_comments"("organizationId", "taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "projects"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goalId_organizationId_fkey" FOREIGN KEY ("goalId", "organizationId") REFERENCES "goals"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_organizationId_fkey" FOREIGN KEY ("parentTaskId", "organizationId") REFERENCES "tasks"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "tasks"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Domain invariants enforced in the database.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_not_own_parent" CHECK ("parentTaskId" IS NULL OR "parentTaskId" <> "id");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_at_matches_status" CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dates_ordered" CHECK ("startsAt" IS NULL OR "dueAt" IS NULL OR "startsAt" <= "dueAt");

-- Rollback (manual): DROP TABLE "task_comments"; DROP TABLE "tasks"; DROP TYPE "TaskPriority"; DROP TYPE "TaskStatus";
