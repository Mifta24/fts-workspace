-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DUE_SOON';

-- CreateTable
CREATE TABLE "task_due_reminders" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_due_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_due_reminders_organizationId_idx" ON "task_due_reminders"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "task_due_reminders_taskId_userId_dueAt_key" ON "task_due_reminders"("taskId", "userId", "dueAt");

-- AddForeignKey
ALTER TABLE "task_due_reminders" ADD CONSTRAINT "task_due_reminders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_due_reminders" ADD CONSTRAINT "task_due_reminders_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "tasks"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rollback (manual): DROP TABLE "task_due_reminders";
-- (a value added to "NotificationType" cannot be removed without recreating the type.)
