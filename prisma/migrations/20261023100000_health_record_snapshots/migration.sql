-- Sealed per-event copies of a member's health record and consent (#924, ADR 0005
-- Addendum B). Additive: new enums and tables only; nothing existing changes.
--
-- A snapshot is one person's record as it stood for one event, kept until the
-- person turns 26 (minors) or 5 years after the event (adults). The row holds no
-- health text and no birth date. Immutability is enforced here, in the database.

-- CreateEnum
CREATE TYPE "HealthSnapshotTrigger" AS ENUM ('CHECK_IN', 'EVENT_START');

-- CreateEnum
CREATE TYPE "HealthSnapshotAgeBasis" AS ENUM ('MINOR', 'ADULT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "HealthSnapshotHoldScope" AS ENUM ('PERSON', 'EVENT');

-- CreateTable
CREATE TABLE "HealthRecordSnapshot" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "trigger" "HealthSnapshotTrigger" NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventDate" TEXT NOT NULL,
    "consentVersion" TEXT,
    "signedOn" TEXT,
    "ageBasis" "HealthSnapshotAgeBasis" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "fieldCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthRecordSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthRecordSnapshotField" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "sealedValue" TEXT NOT NULL,

    CONSTRAINT "HealthRecordSnapshotField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthSnapshotHold" (
    "id" TEXT NOT NULL,
    "scope" "HealthSnapshotHoldScope" NOT NULL,
    "personId" TEXT,
    "eventId" TEXT,
    "reason" TEXT NOT NULL,
    "placedByUserId" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedByUserId" TEXT,
    "liftReason" TEXT,

    CONSTRAINT "HealthSnapshotHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthSnapshotBreakGlass" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "personId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthSnapshotBreakGlass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthRecordSnapshot_expiresAt_idx" ON "HealthRecordSnapshot"("expiresAt");

-- CreateIndex
CREATE INDEX "HealthRecordSnapshot_eventId_idx" ON "HealthRecordSnapshot"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthRecordSnapshot_personId_eventId_key" ON "HealthRecordSnapshot"("personId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthRecordSnapshotField_snapshotId_fieldKey_key" ON "HealthRecordSnapshotField"("snapshotId", "fieldKey");

-- CreateIndex
CREATE INDEX "HealthSnapshotHold_personId_idx" ON "HealthSnapshotHold"("personId");

-- CreateIndex
CREATE INDEX "HealthSnapshotHold_eventId_idx" ON "HealthSnapshotHold"("eventId");

-- CreateIndex
CREATE INDEX "HealthSnapshotBreakGlass_userId_personId_expiresAt_idx" ON "HealthSnapshotBreakGlass"("userId", "personId", "expiresAt");

-- AddForeignKey
ALTER TABLE "HealthRecordSnapshot" ADD CONSTRAINT "HealthRecordSnapshot_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthRecordSnapshot" ADD CONSTRAINT "HealthRecordSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthRecordSnapshotField" ADD CONSTRAINT "HealthRecordSnapshotField_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "HealthRecordSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSnapshotHold" ADD CONSTRAINT "HealthSnapshotHold_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSnapshotHold" ADD CONSTRAINT "HealthSnapshotHold_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSnapshotHold" ADD CONSTRAINT "HealthSnapshotHold_placedByUserId_fkey" FOREIGN KEY ("placedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSnapshotHold" ADD CONSTRAINT "HealthSnapshotHold_liftedByUserId_fkey" FOREIGN KEY ("liftedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSnapshotBreakGlass" ADD CONSTRAINT "HealthSnapshotBreakGlass_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSnapshotBreakGlass" ADD CONSTRAINT "HealthSnapshotBreakGlass_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity.

ALTER TABLE "HealthRecordSnapshot" ADD CONSTRAINT "HealthRecordSnapshot_fieldCount_check" CHECK ("fieldCount" >= 0);
ALTER TABLE "HealthRecordSnapshot" ADD CONSTRAINT "HealthRecordSnapshot_expires_after_taken_check" CHECK ("expiresAt" > "takenAt");

-- A hold names exactly one thing, matching its scope.
ALTER TABLE "HealthSnapshotHold" ADD CONSTRAINT "HealthSnapshotHold_scope_target_check" CHECK (
  ("scope" = 'PERSON' AND "personId" IS NOT NULL AND "eventId" IS NULL)
  OR ("scope" = 'EVENT' AND "eventId" IS NOT NULL AND "personId" IS NULL)
);
ALTER TABLE "HealthSnapshotHold" ADD CONSTRAINT "HealthSnapshotHold_lift_check" CHECK (
  ("liftedAt" IS NULL AND "liftedByUserId" IS NULL AND "liftReason" IS NULL) OR "liftedAt" IS NOT NULL
);
-- At most one active hold per person and per event: placing one twice is a no-op, not a second row.
CREATE UNIQUE INDEX "HealthSnapshotHold_person_active_key" ON "HealthSnapshotHold"("personId") WHERE "liftedAt" IS NULL AND "scope" = 'PERSON';
CREATE UNIQUE INDEX "HealthSnapshotHold_event_active_key" ON "HealthSnapshotHold"("eventId") WHERE "liftedAt" IS NULL AND "scope" = 'EVENT';

-- ---------------------------------------------------------------------------
-- Immutability (mirrors the append-only guards on the lodging and issued-asset
-- history tables). A sealed copy is never updated. It is deleted only by the
-- daily retention job, which sets `imsda.health_snapshot_retention` for its own
-- transaction, and by event deletion, which sets `imsda.event_deletion`.

CREATE FUNCTION "HealthRecordSnapshot_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Sealed health snapshots are immutable.' USING ERRCODE = '23001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(current_setting('imsda.health_snapshot_retention', true), '') = 'on'
       OR COALESCE(current_setting('imsda.event_deletion', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Sealed health snapshots are deleted only by the retention job or with their event.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HealthRecordSnapshot_guard" BEFORE UPDATE OR DELETE ON "HealthRecordSnapshot" FOR EACH ROW EXECUTE FUNCTION "HealthRecordSnapshot_guard"();
CREATE TRIGGER "HealthRecordSnapshotField_guard" BEFORE UPDATE OR DELETE ON "HealthRecordSnapshotField" FOR EACH ROW EXECUTE FUNCTION "HealthRecordSnapshot_guard"();

-- A field can be added only while its snapshot is still short of its declared field count, and the
-- count must be met by the end of the transaction that created the snapshot. So a snapshot is complete
-- when it commits and nothing can be added to it afterwards.
CREATE FUNCTION "HealthRecordSnapshotField_insert_guard"() RETURNS trigger AS $$
DECLARE
  declared integer;
  present integer;
BEGIN
  SELECT "fieldCount" INTO declared FROM "HealthRecordSnapshot" WHERE "id" = NEW."snapshotId";
  SELECT COUNT(*) INTO present FROM "HealthRecordSnapshotField" WHERE "snapshotId" = NEW."snapshotId";
  IF declared IS NULL OR present >= declared THEN
    RAISE EXCEPTION 'A sealed health snapshot cannot be added to.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "HealthRecordSnapshotField_insert_guard" BEFORE INSERT ON "HealthRecordSnapshotField" FOR EACH ROW EXECUTE FUNCTION "HealthRecordSnapshotField_insert_guard"();

CREATE FUNCTION "HealthRecordSnapshot_complete"() RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM "HealthRecordSnapshotField" WHERE "snapshotId" = NEW."id") <> NEW."fieldCount" THEN
    RAISE EXCEPTION 'A sealed health snapshot must be created with all of its fields.' USING ERRCODE = '23001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "HealthRecordSnapshot_complete" AFTER INSERT ON "HealthRecordSnapshot" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "HealthRecordSnapshot_complete"();
