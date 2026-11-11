-- Baptized (#1852): an optional Yes / No / Not sure answer on any roster member.
-- No data moves; existing members stay unanswered.

-- CreateEnum
CREATE TYPE "ClubRosterBaptized" AS ENUM ('YES', 'NO', 'NOT_SURE');

-- AlterTable
ALTER TABLE "ClubRosterMember" ADD COLUMN "baptized" "ClubRosterBaptized";
