-- Club kind (#1517). Additive: one new enum and one defaulted column; safe to re-run.
-- Applying it in production is a human step.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ClubKind" AS ENUM ('PATHFINDER', 'ADVENTURER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "clubKind" "ClubKind" NOT NULL DEFAULT 'PATHFINDER';

-- Backfill: clubs approved from an Adventurer application kept that text on the organization.
UPDATE "Organization" SET "clubKind" = 'ADVENTURER' WHERE "type" = 'CLUB' AND "sourceOrgType" = 'Adventurer Club';
