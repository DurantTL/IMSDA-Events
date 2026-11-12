-- Area Coordinator invite ministries (#843). Additive: one new defaulted column; safe to re-run.
-- Applying it in production is a human step.
--
-- An invite carries the ministries its grant gets when it is accepted. Invites that are already open
-- were made when every coordinator was a Pathfinder coordinator, so they take the PATHFINDER default.

-- AlterTable
ALTER TABLE "AreaCoordinatorInvite" ADD COLUMN IF NOT EXISTS "ministries" "ClubKind"[] NOT NULL DEFAULT ARRAY['PATHFINDER']::"ClubKind"[];
