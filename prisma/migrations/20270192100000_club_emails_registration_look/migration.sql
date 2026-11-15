-- Club emails and the event look (#283 follow-up): a per-event switch, off by default, for whether club emails use the
-- event's published registration look. ADDITIVE ONLY: one NOT NULL column with a default on "Event". Existing events keep
-- today's platform club header for club mail. Applying it in production is a human step (back up first).

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "clubEmailsUseRegistrationLook" BOOLEAN NOT NULL DEFAULT false;
