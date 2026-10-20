-- Central Email settings (#1043): real email is on everywhere by default; a system administrator can pause one event.
-- Additive, then a data step. The old "deliveryMode" and "senderEmail" columns stay, unread by the app after this
-- (the migration preview script reads them); a later cleanup drops them. The central sender (name, email, reply-to)
-- already lives in "PlatformSettings" (defaultSenderName, defaultSenderEmail, defaultReplyToEmail), so no column is
-- added there. Applying this in production is a human step.

-- AlterTable
ALTER TABLE "EventMessageSettings"
    ADD COLUMN "deliveryPaused" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "deliveryPausedAt" TIMESTAMP(3),
    ADD COLUMN "deliveryPausedByUserId" TEXT;

-- Data step. EXTERNAL_EMAIL stays not paused. DISABLED and LOCAL_CAPTURE become paused, so no old or test event
-- suddenly starts sending; an administrator resumes the real ones from System management > Email.
UPDATE "EventMessageSettings"
SET "deliveryPaused" = true,
    "deliveryPausedAt" = CURRENT_TIMESTAMP
WHERE "deliveryMode" IN ('DISABLED', 'LOCAL_CAPTURE');

-- An event that never had settings used to behave as capture-only. Give it a paused row so the new default (real
-- email) cannot start sending for it either. The display name is the platform default, as for a new event.
INSERT INTO "EventMessageSettings" ("id", "eventId", "deliveryMode", "deliveryPaused", "deliveryPausedAt", "senderName", "updatedAt")
SELECT
    'cm' || substr(md5(random()::text || clock_timestamp()::text || e."id"), 1, 22),
    e."id",
    'LOCAL_CAPTURE',
    true,
    CURRENT_TIMESTAMP,
    COALESCE(NULLIF((SELECT "defaultSenderName" FROM "PlatformSettings" WHERE "id" = 'platform'), ''), 'IMSDA Events'),
    CURRENT_TIMESTAMP
FROM "Event" e
WHERE NOT EXISTS (SELECT 1 FROM "EventMessageSettings" s WHERE s."eventId" = e."id");
