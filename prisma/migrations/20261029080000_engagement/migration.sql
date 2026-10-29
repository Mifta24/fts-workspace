-- CreateEnum
CREATE TYPE "LeaderboardVisibility" AS ENUM ('OFF', 'OPT_IN');

-- CreateEnum
CREATE TYPE "PointEventType" AS ENUM ('TASK_COMPLETED');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "leaderboardVisibility" "LeaderboardVisibility" NOT NULL DEFAULT 'OFF';

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "showOnLeaderboard" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "point_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "PointEventType" NOT NULL,
    "points" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "point_events_organizationId_userId_createdAt_idx" ON "point_events"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "point_events_organizationId_createdAt_idx" ON "point_events"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "point_events_organizationId_userId_type_sourceId_key" ON "point_events"("organizationId", "userId", "type", "sourceId");

-- CreateIndex
CREATE INDEX "challenges_organizationId_status_endsAt_idx" ON "challenges"("organizationId", "status", "endsAt");

-- AddForeignKey
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Domain invariants enforced in the database.
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_points_positive" CHECK ("points" > 0 AND "points" <= 100);
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_target_positive" CHECK ("target" > 0 AND "target" <= 100000);
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_window_valid" CHECK ("endsAt" > "startsAt");

-- The points ledger is append-only: rows can never be changed or removed (TRUNCATE is left to
-- test setup and operators).
CREATE FUNCTION "point_events_reject_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'point_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "point_events_append_only" BEFORE UPDATE OR DELETE ON "point_events"
  FOR EACH ROW EXECUTE FUNCTION "point_events_reject_change"();

-- Rollback (manual): DROP TRIGGER "point_events_append_only" ON "point_events"; DROP FUNCTION "point_events_reject_change"(); DROP TABLE "challenges"; DROP TABLE "point_events"; ALTER TABLE "members" DROP COLUMN "showOnLeaderboard"; ALTER TABLE "organizations" DROP COLUMN "leaderboardVisibility"; DROP TYPE "ChallengeStatus"; DROP TYPE "PointEventType"; DROP TYPE "LeaderboardVisibility";
