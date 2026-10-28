-- CreateTable
CREATE TABLE "SignatureEvidence" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "registrationAttendeeId" TEXT,
    "formVersionId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signedText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgentHash" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignatureEvidence_registrationId_idx" ON "SignatureEvidence"("registrationId");

-- CreateIndex
CREATE INDEX "SignatureEvidence_registrationAttendeeId_idx" ON "SignatureEvidence"("registrationAttendeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEvidence_eventId_idempotencyKey_key" ON "SignatureEvidence"("eventId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "SignatureEvidence" ADD CONSTRAINT "SignatureEvidence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvidence" ADD CONSTRAINT "SignatureEvidence_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvidence" ADD CONSTRAINT "SignatureEvidence_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "RegistrationFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Signature evidence (#1265): append-only. UPDATE, DELETE and TRUNCATE are refused for everyone, event deletion included:
-- the event deletion service refuses an event that holds a signature, and every foreign key above is RESTRICT.
CREATE FUNCTION "SignatureEvidence_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SignatureEvidence rows are append-only.' USING ERRCODE = 'AE001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SignatureEvidence_append_only"
BEFORE UPDATE OR DELETE ON "SignatureEvidence"
FOR EACH ROW EXECUTE FUNCTION "SignatureEvidence_append_only"();

CREATE TRIGGER "SignatureEvidence_no_truncate"
BEFORE TRUNCATE ON "SignatureEvidence"
FOR EACH STATEMENT EXECUTE FUNCTION "SignatureEvidence_append_only"();

-- Every reference must belong to the signature's own event, even when the id exists elsewhere: the registration, the attendee
-- on it (when set) and the form version.
CREATE FUNCTION "SignatureEvidence_insert_guard"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Registration" r WHERE r."id" = NEW."registrationId" AND r."eventId" = NEW."eventId") THEN
    RAISE EXCEPTION 'That registration belongs to another event.' USING ERRCODE = 'AE001';
  END IF;
  IF NEW."registrationAttendeeId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "RegistrationAttendee" a
    WHERE a."id" = NEW."registrationAttendeeId" AND a."registrationId" = NEW."registrationId"
  ) THEN
    RAISE EXCEPTION 'That attendee is not on this registration.' USING ERRCODE = 'AE001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "RegistrationFormVersion" v JOIN "RegistrationForm" f ON f."id" = v."formId"
    WHERE v."id" = NEW."formVersionId" AND f."eventId" = NEW."eventId"
  ) THEN
    RAISE EXCEPTION 'That form version belongs to another event.' USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SignatureEvidence_insert_guard"
BEFORE INSERT ON "SignatureEvidence"
FOR EACH ROW EXECUTE FUNCTION "SignatureEvidence_insert_guard"();
