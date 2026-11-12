-- Area Coordinator ministries (#843). Additive: one new defaulted column and one backfill; safe to re-run.
-- Applying it in production is a human step.
--
-- Every Area Coordinator grant that exists today is a Pathfinder coordinator (Adventurer
-- coordinators still use another system), so existing rows take the PATHFINDER default.

-- AlterTable
ALTER TABLE "AreaCoordinatorGrant" ADD COLUMN IF NOT EXISTS "ministries" "ClubKind"[] NOT NULL DEFAULT ARRAY['PATHFINDER']::"ClubKind"[];

-- Backfill: visiting Adventurer clubs were created without a ministry and read as Pathfinder clubs.
UPDATE "Organization" SET "clubKind" = 'ADVENTURER' WHERE "type" = 'CLUB' AND "sourceOrgType" = 'Visiting Adventurer Club';
