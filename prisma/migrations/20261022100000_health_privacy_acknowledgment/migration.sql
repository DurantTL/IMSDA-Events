-- Health records: owner decisions of 2026-10-14 (#923, ADR 0005 Addendum B).
-- Additive: one new table for the one-time privacy acknowledgment (per person
-- and wording version) and one nullable plain date on HealthRecord.

-- When a record was last saved or confirmed: the date a Registrar (write-only)
-- is shown. Existing records take their last change as that date.
ALTER TABLE "HealthRecord" ADD COLUMN "lastConfirmedAt" TIMESTAMP(3);
UPDATE "HealthRecord" SET "lastConfirmedAt" = "updatedAt" WHERE "confirmedClubYear" IS NOT NULL;

CREATE TABLE "HealthPrivacyAcknowledgment" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "attendeeAccountId" TEXT,
    "version" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthPrivacyAcknowledgment_pkey" PRIMARY KEY ("id"),
    -- Exactly one person: a staff user or an attendee account.
    CONSTRAINT "HealthPrivacyAcknowledgment_one_person_check" CHECK (("userId" IS NULL) <> ("attendeeAccountId" IS NULL))
);

CREATE UNIQUE INDEX "HealthPrivacyAcknowledgment_userId_version_key" ON "HealthPrivacyAcknowledgment"("userId", "version");
CREATE UNIQUE INDEX "HealthPrivacyAcknowledgment_attendeeAccountId_version_key" ON "HealthPrivacyAcknowledgment"("attendeeAccountId", "version");

ALTER TABLE "HealthPrivacyAcknowledgment" ADD CONSTRAINT "HealthPrivacyAcknowledgment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HealthPrivacyAcknowledgment" ADD CONSTRAINT "HealthPrivacyAcknowledgment_attendeeAccountId_fkey" FOREIGN KEY ("attendeeAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
