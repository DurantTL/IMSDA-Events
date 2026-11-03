-- Acknowledgment decline and withdrawal (#130). Additive: existing evidence rows become ACKNOWLEDGE, and nothing is
-- rewritten. Every guard raises SQLSTATE 'AE001', like the evidence guards before it.

-- CreateEnum
CREATE TYPE "AcknowledgmentAction" AS ENUM ('ACKNOWLEDGE', 'DECLINE');

-- AlterTable: a constant default adds the column without touching existing rows (so the append-only trigger never fires).
ALTER TABLE "AcknowledgmentEvidence" ADD COLUMN "action" "AcknowledgmentAction" NOT NULL DEFAULT 'ACKNOWLEDGE';
ALTER TABLE "AcknowledgmentEvidence" ADD COLUMN "paperLocation" TEXT;

-- Where a paper form physically lives, never what it says: only on a PAPER row, 1 to 200 characters.
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_paper_location_check" CHECK (
  "paperLocation" IS NULL OR ("channel" = 'PAPER' AND length(btrim("paperLocation")) BETWEEN 1 AND 200)
);

-- A decline is recorded by staff from a conversation or a paper form: an unticked online box is not a decline.
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_decline_channel_check" CHECK (
  "action" = 'ACKNOWLEDGE' OR "channel" <> 'ONLINE'
);

-- CreateTable
CREATE TABLE "AcknowledgmentWithdrawal" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "actedByPersonId" TEXT NOT NULL,
    "recordedByUserId" TEXT,
    "channel" "AcknowledgmentChannel" NOT NULL,
    "subjectMinorStatus" TEXT NOT NULL,
    "guardianAuthorityId" TEXT,
    "paperLocation" TEXT,
    "withdrawnAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "AcknowledgmentWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcknowledgmentWithdrawal_evidenceId_key" ON "AcknowledgmentWithdrawal"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "AcknowledgmentWithdrawal_eventId_idempotencyKey_key" ON "AcknowledgmentWithdrawal"("eventId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AcknowledgmentWithdrawal_registrationId_idx" ON "AcknowledgmentWithdrawal"("registrationId");

-- CreateIndex
CREATE INDEX "AcknowledgmentWithdrawal_eventId_idx" ON "AcknowledgmentWithdrawal"("eventId");

-- AddForeignKey
ALTER TABLE "AcknowledgmentWithdrawal" ADD CONSTRAINT "AcknowledgmentWithdrawal_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentWithdrawal" ADD CONSTRAINT "AcknowledgmentWithdrawal_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentWithdrawal" ADD CONSTRAINT "AcknowledgmentWithdrawal_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "AcknowledgmentEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentWithdrawal" ADD CONSTRAINT "AcknowledgmentWithdrawal_actedByPersonId_fkey" FOREIGN KEY ("actedByPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentWithdrawal" ADD CONSTRAINT "AcknowledgmentWithdrawal_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same shape rules as evidence: staff-entered and paper withdrawals name the staff member; a minor's names the declared
-- guardian authority (#131); the paper location only on PAPER, 1 to 200 characters.
ALTER TABLE "AcknowledgmentWithdrawal" ADD CONSTRAINT "AcknowledgmentWithdrawal_channel_check" CHECK (
  ("channel" = 'ONLINE') = ("recordedByUserId" IS NULL)
);
ALTER TABLE "AcknowledgmentWithdrawal" ADD CONSTRAINT "AcknowledgmentWithdrawal_minor_check" CHECK (
  "subjectMinorStatus" IN ('MINOR', 'ADULT', 'UNKNOWN')
  AND ("subjectMinorStatus" <> 'MINOR' OR "guardianAuthorityId" IS NOT NULL)
);
ALTER TABLE "AcknowledgmentWithdrawal" ADD CONSTRAINT "AcknowledgmentWithdrawal_paper_location_check" CHECK (
  "paperLocation" IS NULL OR ("channel" = 'PAPER' AND length(btrim("paperLocation")) BETWEEN 1 AND 200)
);

-- Append-only, event deletion included (no exception), and no TRUNCATE.
CREATE TRIGGER "AcknowledgmentWithdrawal_append_only"
BEFORE UPDATE OR DELETE ON "AcknowledgmentWithdrawal"
FOR EACH ROW EXECUTE FUNCTION "AcknowledgmentEvidence_append_only"();

CREATE TRIGGER "AcknowledgmentWithdrawal_no_truncate"
BEFORE TRUNCATE ON "AcknowledgmentWithdrawal"
FOR EACH STATEMENT EXECUTE FUNCTION "AcknowledgmentEvidence_append_only"();

-- A withdrawal withdraws an acceptance (never a decline) of the same event and registration, and cannot predate it.
CREATE FUNCTION "AcknowledgmentWithdrawal_insert_guard"() RETURNS trigger AS $$
DECLARE
  accepted_at timestamp(3);
BEGIN
  SELECT e."acknowledgedAt" INTO accepted_at FROM "AcknowledgmentEvidence" e
  WHERE e."id" = NEW."evidenceId" AND e."eventId" = NEW."eventId" AND e."registrationId" = NEW."registrationId" AND e."action" = 'ACKNOWLEDGE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A withdrawal must name an acceptance of the same event and registration.' USING ERRCODE = 'AE001';
  END IF;
  IF NEW."withdrawnAt" < accepted_at THEN
    RAISE EXCEPTION 'A withdrawal cannot be dated before the acceptance it withdraws.' USING ERRCODE = 'AE001';
  END IF;
  IF NEW."guardianAuthorityId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "GuardianAuthority" g JOIN "AcknowledgmentEvidence" e ON e."id" = NEW."evidenceId"
    WHERE g."id" = NEW."guardianAuthorityId" AND g."minorPersonId" = e."subjectPersonId" AND g."eventId" = NEW."eventId"
      AND g."registrationId" = NEW."registrationId" AND g."adultPersonId" = NEW."actedByPersonId"
  ) THEN
    RAISE EXCEPTION 'That guardian authority is not a declaration for this minor, on this registration, naming the person who withdrew.' USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AcknowledgmentWithdrawal_insert_guard"
BEFORE INSERT ON "AcknowledgmentWithdrawal"
FOR EACH ROW EXECUTE FUNCTION "AcknowledgmentWithdrawal_insert_guard"();

-- One live acceptance per subject, field and content still holds, but only acceptances count: a decline is never part of
-- these indexes. A voided or withdrawn acceptance can be accepted again as the next generation.
DROP INDEX "AcknowledgmentEvidence_one_per_registration_content";
DROP INDEX "AcknowledgmentEvidence_one_per_attendee_content";
CREATE UNIQUE INDEX "AcknowledgmentEvidence_one_per_registration_content"
  ON "AcknowledgmentEvidence"("registrationId", "fieldKey", "contentRef", "generation")
  WHERE "registrationAttendeeId" IS NULL AND "action" = 'ACKNOWLEDGE';
CREATE UNIQUE INDEX "AcknowledgmentEvidence_one_per_attendee_content"
  ON "AcknowledgmentEvidence"("registrationAttendeeId", "fieldKey", "contentRef", "generation")
  WHERE "registrationAttendeeId" IS NOT NULL AND "action" = 'ACKNOWLEDGE';

-- The evidence insert guard, with the generation rule widened: an acceptance's generation is the number of earlier
-- acceptances of this subject, field and content that were voided, withdrawn, or ended by a later withdrawal for the same subject and field. A decline has generation 0.
CREATE OR REPLACE FUNCTION "AcknowledgmentEvidence_insert_guard"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Registration" r WHERE r."id" = NEW."registrationId" AND r."eventId" = NEW."eventId") THEN
    RAISE EXCEPTION 'That registration belongs to another event.' USING ERRCODE = 'AE001';
  END IF;
  IF NEW."registrationAttendeeId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "RegistrationAttendee" a
    WHERE a."id" = NEW."registrationAttendeeId" AND a."registrationId" = NEW."registrationId" AND a."personId" = NEW."subjectPersonId"
  ) THEN
    RAISE EXCEPTION 'That attendee is not the subject person on this registration.' USING ERRCODE = 'AE001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "RegistrationFormVersion" v JOIN "RegistrationForm" f ON f."id" = v."formId"
    WHERE v."id" = NEW."formVersionId" AND f."eventId" = NEW."eventId"
  ) THEN
    RAISE EXCEPTION 'That form version belongs to another event.' USING ERRCODE = 'AE001';
  END IF;
  IF NEW."generation" <> (
    CASE WHEN NEW."action" = 'ACKNOWLEDGE' THEN (
      SELECT count(*) FROM "AcknowledgmentEvidence" e
      WHERE e."registrationId" = NEW."registrationId"
        AND e."registrationAttendeeId" IS NOT DISTINCT FROM NEW."registrationAttendeeId"
        AND e."fieldKey" = NEW."fieldKey" AND e."contentRef" = NEW."contentRef"
        AND e."action" = 'ACKNOWLEDGE'
        AND (
          EXISTS (SELECT 1 FROM "AcknowledgmentVoid" v WHERE v."evidenceId" = e."id")
          OR EXISTS (SELECT 1 FROM "AcknowledgmentWithdrawal" w WHERE w."evidenceId" = e."id")
          -- A withdrawal ends every acceptance of this subject and field that comes before it in the order of events.
          OR EXISTS (
            SELECT 1 FROM "AcknowledgmentWithdrawal" w JOIN "AcknowledgmentEvidence" we ON we."id" = w."evidenceId"
            WHERE we."registrationId" = e."registrationId"
              AND we."registrationAttendeeId" IS NOT DISTINCT FROM e."registrationAttendeeId"
              AND we."fieldKey" = e."fieldKey"
              -- The order of events: when it took effect, when it was recorded, then the evidence id (acceptance before its own withdrawal).
              AND (w."withdrawnAt", w."recordedAt", we."id" COLLATE "C") >= (e."acknowledgedAt", e."recordedAt", e."id" COLLATE "C")
          )
        )
    ) ELSE 0 END
  ) THEN
    RAISE EXCEPTION 'The generation must equal the number of voided or withdrawn earlier acceptances of this content (0 for a decline).' USING ERRCODE = 'AE001';
  END IF;
  IF NEW."guardianAuthorityId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "GuardianAuthority" g
    WHERE g."id" = NEW."guardianAuthorityId" AND g."minorPersonId" = NEW."subjectPersonId" AND g."eventId" = NEW."eventId"
      AND g."registrationId" = NEW."registrationId" AND g."adultPersonId" = NEW."actedByPersonId"
  ) THEN
    RAISE EXCEPTION 'That guardian authority is not a declaration for this minor, on this registration, naming the person who acknowledged.' USING ERRCODE = 'AE001';
  END IF;
  IF NEW."policyVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ConsentPolicyVersion" v JOIN "ConsentPolicy" p ON p."id" = v."policyId"
    WHERE v."id" = NEW."policyVersionId"
      AND v."status" = 'PUBLISHED'
      AND p."kind" = 'ACKNOWLEDGMENT'
      AND (p."eventId" IS NULL OR p."eventId" = NEW."eventId")
  ) THEN
    RAISE EXCEPTION 'The policy version must be a published acknowledgment version reachable from this event.' USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
