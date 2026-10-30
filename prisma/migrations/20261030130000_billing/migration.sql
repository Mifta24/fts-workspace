-- CreateEnum
CREATE TYPE "PlanKey" AS ENUM ('FREE', 'TEAM', 'BUSINESS');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "planKey" "PlanKey" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organizationId_key" ON "subscriptions"("organizationId");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A trial needs an end; an active subscription has none.
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_has_end" CHECK (("status" = 'TRIALING') = ("trialEndsAt" IS NOT NULL));

-- Rollback (manual): DROP TABLE "subscriptions"; ALTER TABLE "organizations" DROP COLUMN "suspendedAt"; DROP TYPE "SubscriptionStatus"; DROP TYPE "PlanKey";
