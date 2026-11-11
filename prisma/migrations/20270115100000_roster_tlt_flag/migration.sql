-- TLT becomes a yes/no on youth roster members instead of a current class (#1851),
-- and Basic Staff Training joins the class list (a Master Guide prerequisite).
-- The TLT enum value stays: class history, monthly report class lists and honor
-- minimum levels still use it. The new value is not used in this migration.
ALTER TYPE "ClubClassLevel" ADD VALUE IF NOT EXISTS 'BASIC_STAFF_TRAINING' BEFORE 'MASTER_GUIDE';

-- AlterTable
ALTER TABLE "ClubRosterMember" ADD COLUMN "isTlt" BOOLEAN NOT NULL DEFAULT false;

-- A youth whose current class was TLT is now flagged TLT; the class is left blank
-- for the director to fill in. The flag is youth only, so anyone else just loses
-- the TLT class.
UPDATE "ClubRosterMember" SET "isTlt" = true, "classLevel" = NULL
WHERE "classLevel" = 'TLT' AND "attendeeType" = 'YOUTH';

UPDATE "ClubRosterMember" SET "classLevel" = NULL
WHERE "classLevel" = 'TLT';
