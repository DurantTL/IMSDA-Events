-- TLT year move-up (#1686). Additive only: one nullable column on TltProfile holding the club year its tltYear applies
-- to, so the club-year rollover can offer each TLT a move up a year (reviewed and confirmed, never automatic).
-- Existing rows with a year are backfilled from the club year (September to August, UTC) of their last update.

-- AlterTable
ALTER TABLE "TltProfile" ADD COLUMN "tltYearClubYear" TEXT;

-- Backfill
UPDATE "TltProfile"
SET "tltYearClubYear" =
  CASE WHEN EXTRACT(MONTH FROM "updatedAt") >= 9 THEN EXTRACT(YEAR FROM "updatedAt")::int ELSE EXTRACT(YEAR FROM "updatedAt")::int - 1 END::text
  || '-' ||
  LPAD((((CASE WHEN EXTRACT(MONTH FROM "updatedAt") >= 9 THEN EXTRACT(YEAR FROM "updatedAt")::int ELSE EXTRACT(YEAR FROM "updatedAt")::int - 1 END) + 1) % 100)::text, 2, '0')
WHERE "tltYear" IS NOT NULL;
