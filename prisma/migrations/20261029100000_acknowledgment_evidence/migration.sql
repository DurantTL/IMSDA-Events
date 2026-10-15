-- CreateEnum
CREATE TYPE "AcknowledgmentChannel" AS ENUM ('ONLINE', 'STAFF_ENTERED', 'PAPER');

-- CreateEnum
CREATE TYPE "AcknowledgmentSource" AS ENUM ('TEXT', 'POLICY_VERSION');

-- CreateTable
CREATE TABLE "AcknowledgmentEvidence" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "registrationAttendeeId" TEXT,
    "subjectPersonId" TEXT,
    "actedByPersonId" TEXT NOT NULL,
    "recordedByUserId" TEXT,
    "channel" "AcknowledgmentChannel" NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "source" "AcknowledgmentSource" NOT NULL,
    "shownText" TEXT,
    "policyVersionId" TEXT,
    "contentHash" TEXT NOT NULL,
    "contentRef" TEXT NOT NULL,
    "subjectMinorStatus" TEXT NOT NULL,
    "guardianAuthorityId" TEXT,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestMetadata" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AcknowledgmentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcknowledgmentEvidence_registrationId_fieldKey_acknowledged_idx" ON "AcknowledgmentEvidence"("registrationId", "fieldKey", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "AcknowledgmentEvidence_registrationAttendeeId_fieldKey_ackn_idx" ON "AcknowledgmentEvidence"("registrationAttendeeId", "fieldKey", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "AcknowledgmentEvidence_policyVersionId_idx" ON "AcknowledgmentEvidence"("policyVersionId");

-- CreateIndex
CREATE INDEX "AcknowledgmentEvidence_subjectPersonId_idx" ON "AcknowledgmentEvidence"("subjectPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "AcknowledgmentEvidence_eventId_idempotencyKey_key" ON "AcknowledgmentEvidence"("eventId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_subjectPersonId_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_actedByPersonId_fkey" FOREIGN KEY ("actedByPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "RegistrationFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "ConsentPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Acknowledgment evidence (#150): shape, uniqueness and append-only guards.
-- Every guard raises SQLSTATE 'AE001' so the application can answer 409 for any of them without matching text.

-- What is recorded is exactly one of: the text shown, or a published policy version.
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_source_check" CHECK (
  ("source" = 'TEXT' AND "shownText" IS NOT NULL AND "policyVersionId" IS NULL AND "contentRef" = 'text:' || "contentHash")
  OR ("source" = 'POLICY_VERSION' AND "shownText" IS NULL AND "policyVersionId" IS NOT NULL AND "contentRef" = 'policy:' || "policyVersionId")
);

-- A registration-level subject has no person or attendee; an attendee subject has both.
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_subject_check" CHECK (
  ("registrationAttendeeId" IS NULL) = ("subjectPersonId" IS NULL)
);

-- Online evidence has no staff recorder; staff-entered and paper evidence always name the staff member.
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_channel_check" CHECK (
  ("channel" = 'ONLINE') = ("recordedByUserId" IS NULL)
);

-- A minor's acknowledgment always names the declared guardian authority (#131) that allowed it. Household
-- membership and account-holder status are never recorded as authority.
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_minor_check" CHECK (
  "subjectMinorStatus" IN ('MINOR', 'ADULT', 'UNKNOWN')
  AND ("subjectMinorStatus" <> 'MINOR' OR "guardianAuthorityId" IS NOT NULL)
);

-- Only the approved request metadata keys can be stored (see `approvedRequestMetadata`).
ALTER TABLE "AcknowledgmentEvidence" ADD CONSTRAINT "AcknowledgmentEvidence_request_metadata_check" CHECK (
  jsonb_typeof("requestMetadata") = 'object'
  AND ("requestMetadata" - ARRAY['userAgentHash', 'formVersionId', 'submissionKey']) = '{}'::jsonb
);

-- A retry, or a second entry of the same content, cannot create a second row for the same subject and content.
-- A voided acknowledgment can be recorded again as the next generation (see the insert guard); never two live rows.
CREATE UNIQUE INDEX "AcknowledgmentEvidence_one_per_registration_content"
  ON "AcknowledgmentEvidence"("registrationId", "fieldKey", "contentRef", "generation") WHERE "registrationAttendeeId" IS NULL;
CREATE UNIQUE INDEX "AcknowledgmentEvidence_one_per_attendee_content"
  ON "AcknowledgmentEvidence"("registrationAttendeeId", "fieldKey", "contentRef", "generation") WHERE "registrationAttendeeId" IS NOT NULL;

-- Evidence is append-only. UPDATE and DELETE are refused for everyone, event deletion included: the event deletion
-- service refuses an event that holds evidence (retention of evidence on deletion is a human decision), and every
-- foreign key above is RESTRICT, so nothing can reach the rows through a cascade either.
CREATE FUNCTION "AcknowledgmentEvidence_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AcknowledgmentEvidence rows are append-only.' USING ERRCODE = 'AE001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AcknowledgmentEvidence_append_only"
BEFORE UPDATE OR DELETE ON "AcknowledgmentEvidence"
FOR EACH ROW EXECUTE FUNCTION "AcknowledgmentEvidence_append_only"();

-- TRUNCATE does not fire row triggers, so it needs its own statement-level guard.
CREATE TRIGGER "AcknowledgmentEvidence_no_truncate"
BEFORE TRUNCATE ON "AcknowledgmentEvidence"
FOR EACH STATEMENT EXECUTE FUNCTION "AcknowledgmentEvidence_append_only"();

-- Every reference must belong to the evidence's own event, even when the id exists elsewhere: the registration, the
-- attendee on it, the declared authority (for this minor, at this event), the form version, and a policy version that is published, of the acknowledgment kind, and either
-- the event's own or organization-scoped.
CREATE FUNCTION "AcknowledgmentEvidence_insert_guard"() RETURNS trigger AS $$
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
    SELECT count(*) FROM "AcknowledgmentEvidence" e JOIN "AcknowledgmentVoid" v ON v."evidenceId" = e."id"
    WHERE e."registrationId" = NEW."registrationId"
      AND e."registrationAttendeeId" IS NOT DISTINCT FROM NEW."registrationAttendeeId"
      AND e."fieldKey" = NEW."fieldKey" AND e."contentRef" = NEW."contentRef"
  ) THEN
    RAISE EXCEPTION 'The generation must equal the number of voided earlier acknowledgments of this content.' USING ERRCODE = 'AE001';
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

CREATE TRIGGER "AcknowledgmentEvidence_insert_guard"
BEFORE INSERT ON "AcknowledgmentEvidence"
FOR EACH ROW EXECUTE FUNCTION "AcknowledgmentEvidence_insert_guard"();

-- A correction: staff void a row with a reason. A separate append-only table, so the evidence row itself is never touched.
-- CreateTable
CREATE TABLE "AcknowledgmentVoid" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "voidedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcknowledgmentVoid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcknowledgmentVoid_evidenceId_key" ON "AcknowledgmentVoid"("evidenceId");

-- CreateIndex
CREATE INDEX "AcknowledgmentVoid_registrationId_idx" ON "AcknowledgmentVoid"("registrationId");

-- CreateIndex
CREATE INDEX "AcknowledgmentVoid_eventId_idx" ON "AcknowledgmentVoid"("eventId");

-- AddForeignKey
ALTER TABLE "AcknowledgmentVoid" ADD CONSTRAINT "AcknowledgmentVoid_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentVoid" ADD CONSTRAINT "AcknowledgmentVoid_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentVoid" ADD CONSTRAINT "AcknowledgmentVoid_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "AcknowledgmentEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentVoid" ADD CONSTRAINT "AcknowledgmentVoid_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AcknowledgmentVoid" ADD CONSTRAINT "AcknowledgmentVoid_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000);

CREATE TRIGGER "AcknowledgmentVoid_append_only"
BEFORE UPDATE OR DELETE ON "AcknowledgmentVoid"
FOR EACH ROW EXECUTE FUNCTION "AcknowledgmentEvidence_append_only"();

CREATE TRIGGER "AcknowledgmentVoid_no_truncate"
BEFORE TRUNCATE ON "AcknowledgmentVoid"
FOR EACH STATEMENT EXECUTE FUNCTION "AcknowledgmentEvidence_append_only"();

-- The void must belong to the same event and registration as the evidence it voids.
CREATE FUNCTION "AcknowledgmentVoid_insert_guard"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "AcknowledgmentEvidence" e
    WHERE e."id" = NEW."evidenceId" AND e."eventId" = NEW."eventId" AND e."registrationId" = NEW."registrationId"
  ) THEN
    RAISE EXCEPTION 'A void must name evidence of the same event and registration.' USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AcknowledgmentVoid_insert_guard"
BEFORE INSERT ON "AcknowledgmentVoid"
FOR EACH ROW EXECUTE FUNCTION "AcknowledgmentVoid_insert_guard"();
