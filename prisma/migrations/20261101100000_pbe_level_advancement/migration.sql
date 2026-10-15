-- PBE teams advance from Area to Conference and Union inside the same event (#945). Additive only: two nullable
-- columns on ClubTeamResult, one table for team check-in at a level above Area, and one email template key.
-- Nothing existing is changed or backfilled: a free-text placement stays as it is, readable, with no number until
-- staff re-enter it, and every existing `qualified` value is kept.

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'CLUB_TEAM_ADVANCEMENT_NOTICE';

-- AlterTable
ALTER TABLE "ClubTeamResult" ADD COLUMN     "placementRank" INTEGER,
ADD COLUMN     "advanceOverride" BOOLEAN;

-- CreateTable
CREATE TABLE "ClubTeamLevelCheckIn" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "clubEventRegistrationId" TEXT NOT NULL,
    "level" "TeamResultLevel" NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInByUserId" TEXT,
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubTeamLevelCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubTeamLevelCheckIn_eventId_level_idx" ON "ClubTeamLevelCheckIn"("eventId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "ClubTeamLevelCheckIn_clubEventRegistrationId_level_key" ON "ClubTeamLevelCheckIn"("clubEventRegistrationId", "level");

-- AddForeignKey
ALTER TABLE "ClubTeamLevelCheckIn" ADD CONSTRAINT "ClubTeamLevelCheckIn_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubTeamLevelCheckIn" ADD CONSTRAINT "ClubTeamLevelCheckIn_clubEventRegistrationId_fkey" FOREIGN KEY ("clubEventRegistrationId") REFERENCES "ClubEventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubTeamLevelCheckIn" ADD CONSTRAINT "ClubTeamLevelCheckIn_checkedInByUserId_fkey" FOREIGN KEY ("checkedInByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A placement is a positive whole number when it is there.
ALTER TABLE "ClubTeamResult" ADD CONSTRAINT "ClubTeamResult_placementRank_positive" CHECK ("placementRank" IS NULL OR "placementRank" >= 1);
