-- CreateEnum
CREATE TYPE "IssuedAssetMode" AS ENUM ('SERIALIZED', 'QUANTITY');

-- CreateEnum
CREATE TYPE "IssuedAssetAssigneeKind" AS ENUM ('ATTENDEE', 'REGISTRATION', 'STAFF', 'ROOM', 'VEHICLE', 'TEAM');

-- CreateEnum
CREATE TYPE "IssuedAssetCondition" AS ENUM ('NEW', 'GOOD', 'WORN', 'DAMAGED');

-- CreateEnum
CREATE TYPE "IssuedAssetAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'RETIRED');

-- CreateEnum
CREATE TYPE "IssuedAssetEntryMethod" AS ENUM ('MANUAL', 'SCAN', 'OFFLINE');

-- CreateEnum
CREATE TYPE "IssuedAssetEndReason" AS ENUM ('TRANSFERRED', 'REPLACED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "IssuedAssetEventType" AS ENUM ('ISSUED', 'TRANSFERRED_OUT', 'TRANSFERRED_IN', 'REPLACED_OUT', 'REPLACED_IN', 'CORRECTED');

-- CreateTable
CREATE TABLE "IssuedAssetType" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "IssuedAssetMode" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assigneeKinds" "IssuedAssetAssigneeKind"[],
    "roomLinked" BOOLEAN NOT NULL DEFAULT false,
    "depositPolicyRef" TEXT,
    "replacementPolicyRef" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuedAssetType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedAsset" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "assetTypeId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "scanCode" TEXT NOT NULL,
    "quantityTotal" INTEGER NOT NULL DEFAULT 1,
    "condition" "IssuedAssetCondition" NOT NULL DEFAULT 'GOOD',
    "location" TEXT,
    "availability" "IssuedAssetAvailability" NOT NULL DEFAULT 'AVAILABLE',
    "issueVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetIssuance" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "serialized" BOOLEAN NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "assigneeKind" "IssuedAssetAssigneeKind" NOT NULL,
    "attendeeId" TEXT,
    "registrationId" TEXT,
    "staffUserId" TEXT,
    "roomUnitId" TEXT,
    "sourceAssignmentId" TEXT,
    "assigneeLabel" TEXT,
    "purpose" TEXT NOT NULL,
    "expectedReturnAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "entryMethod" "IssuedAssetEntryMethod" NOT NULL,
    "idempotencyKey" TEXT,
    "previousIssuanceId" TEXT,
    "endedAt" TIMESTAMP(3),
    "endReason" "IssuedAssetEndReason",
    "endedByUserId" TEXT,
    "endNote" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetIssuance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetIssuanceHistory" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "issuanceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "IssuedAssetEventType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT,
    "entryMethod" "IssuedAssetEntryMethod" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "assigneeKind" "IssuedAssetAssigneeKind" NOT NULL,
    "attendeeId" TEXT,
    "registrationId" TEXT,
    "staffUserId" TEXT,
    "roomUnitId" TEXT,
    "sourceAssignmentId" TEXT,
    "assigneeLabel" TEXT,
    "relatedIssuanceId" TEXT,
    "revision" INTEGER NOT NULL,

    CONSTRAINT "AssetIssuanceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssuedAssetType_eventId_name_key" ON "IssuedAssetType"("eventId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedAssetType_id_eventId_key" ON "IssuedAssetType"("id", "eventId");

-- CreateIndex
CREATE INDEX "IssuedAsset_eventId_assetTypeId_idx" ON "IssuedAsset"("eventId", "assetTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedAsset_eventId_identifier_key" ON "IssuedAsset"("eventId", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedAsset_eventId_scanCode_key" ON "IssuedAsset"("eventId", "scanCode");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedAsset_id_eventId_key" ON "IssuedAsset"("id", "eventId");

-- CreateIndex
CREATE INDEX "AssetIssuance_eventId_assetId_idx" ON "AssetIssuance"("eventId", "assetId");

-- CreateIndex
CREATE INDEX "AssetIssuance_attendeeId_idx" ON "AssetIssuance"("attendeeId");

-- CreateIndex
CREATE INDEX "AssetIssuance_registrationId_idx" ON "AssetIssuance"("registrationId");

-- CreateIndex
CREATE INDEX "AssetIssuance_eventId_roomUnitId_idx" ON "AssetIssuance"("eventId", "roomUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetIssuance_eventId_idempotencyKey_key" ON "AssetIssuance"("eventId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssetIssuance_id_eventId_key" ON "AssetIssuance"("id", "eventId");

-- CreateIndex
CREATE INDEX "AssetIssuanceHistory_eventId_at_idx" ON "AssetIssuanceHistory"("eventId", "at");

-- CreateIndex
CREATE INDEX "AssetIssuanceHistory_issuanceId_at_idx" ON "AssetIssuanceHistory"("issuanceId", "at");

-- CreateIndex
CREATE INDEX "AssetIssuanceHistory_assetId_at_idx" ON "AssetIssuanceHistory"("assetId", "at");

-- AddForeignKey
ALTER TABLE "IssuedAssetType" ADD CONSTRAINT "IssuedAssetType_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedAsset" ADD CONSTRAINT "IssuedAsset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedAsset" ADD CONSTRAINT "IssuedAsset_assetTypeId_eventId_fkey" FOREIGN KEY ("assetTypeId", "eventId") REFERENCES "IssuedAssetType"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_assetId_eventId_fkey" FOREIGN KEY ("assetId", "eventId") REFERENCES "IssuedAsset"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "RegistrationAttendee"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_roomUnitId_eventId_fkey" FOREIGN KEY ("roomUnitId", "eventId") REFERENCES "EventLodgingUnit"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_sourceAssignmentId_eventId_fkey" FOREIGN KEY ("sourceAssignmentId", "eventId") REFERENCES "EventLodgingAssignment"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIssuanceHistory" ADD CONSTRAINT "AssetIssuanceHistory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIssuanceHistory" ADD CONSTRAINT "AssetIssuanceHistory_issuanceId_eventId_fkey" FOREIGN KEY ("issuanceId", "eventId") REFERENCES "AssetIssuance"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;




-- ---------------------------------------------------------------------------
-- Constraints and triggers Prisma cannot express (#213). Additive only.
-- One open issuance per serialized asset, no quantity over-issue, holder columns that match the kind, issuances that
-- change only to end, and history that is append-only. Every row goes only with its event.
-- ---------------------------------------------------------------------------

-- Delete refusal shared by the issued-asset tables: rows go only with their event. That is the cascade once the event
-- is gone, or the event deletion service's own explicit deletes (it sets the transaction-local setting
-- `imsda.event_deletion`). Nothing else can delete one: an asset is retired, never removed.
CREATE FUNCTION "IssuedAsset_refuse_delete"() RETURNS trigger AS $$
BEGIN
  IF current_setting('imsda.event_deletion', true) = 'on'
     OR (pg_trigger_depth() > 1 AND NOT EXISTS (SELECT 1 FROM "Event" WHERE "id" = OLD."eventId")) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Issued-asset records are never deleted while the event exists.' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "IssuedAssetType_no_delete" BEFORE DELETE ON "IssuedAssetType" FOR EACH ROW EXECUTE FUNCTION "IssuedAsset_refuse_delete"();
CREATE TRIGGER "IssuedAsset_no_delete" BEFORE DELETE ON "IssuedAsset" FOR EACH ROW EXECUTE FUNCTION "IssuedAsset_refuse_delete"();
CREATE TRIGGER "AssetIssuance_no_delete" BEFORE DELETE ON "AssetIssuance" FOR EACH ROW EXECUTE FUNCTION "IssuedAsset_refuse_delete"();
CREATE TRIGGER "AssetIssuanceHistory_no_delete" BEFORE DELETE ON "AssetIssuanceHistory" FOR EACH ROW EXECUTE FUNCTION "IssuedAsset_refuse_delete"();

-- Types: a name, and at least one kind of holder.
ALTER TABLE "IssuedAssetType" ADD CONSTRAINT "IssuedAssetType_name_present" CHECK (length(btrim("name")) > 0);
ALTER TABLE "IssuedAssetType" ADD CONSTRAINT "IssuedAssetType_has_assignee_kind" CHECK (cardinality("assigneeKinds") >= 1);

-- A type's mode never changes once it has assets (a serialized key is not a lot of 60).
CREATE FUNCTION "IssuedAssetType_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."eventId" IS DISTINCT FROM OLD."eventId" THEN
    RAISE EXCEPTION 'An asset type cannot move to another event.' USING ERRCODE = '23001';
  END IF;
  IF NEW."mode" IS DISTINCT FROM OLD."mode" AND EXISTS (SELECT 1 FROM "IssuedAsset" WHERE "assetTypeId" = NEW."id") THEN
    RAISE EXCEPTION 'An asset type that has assets keeps its serialized or quantity behaviour.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "IssuedAssetType_guard" BEFORE UPDATE ON "IssuedAssetType" FOR EACH ROW EXECUTE FUNCTION "IssuedAssetType_guard"();

-- Assets: a normalised identifier and scan code (trimmed, upper case, no blanks), at least one in stock, and a serialized
-- asset is exactly one. The lot can never drop below what is out.
ALTER TABLE "IssuedAsset" ADD CONSTRAINT "IssuedAsset_codes_normalised" CHECK (
  length("identifier") > 0 AND "identifier" = upper(btrim("identifier")) AND "identifier" !~ '\s'
  AND length("scanCode") > 0 AND "scanCode" = upper(btrim("scanCode")) AND "scanCode" !~ '\s'
);
ALTER TABLE "IssuedAsset" ADD CONSTRAINT "IssuedAsset_quantity_positive" CHECK ("quantityTotal" >= 1);

CREATE FUNCTION "IssuedAsset_guard"() RETURNS trigger AS $$
DECLARE
  typeMode "IssuedAssetMode";
  held integer;
BEGIN
  SELECT "mode" INTO typeMode FROM "IssuedAssetType" WHERE "id" = NEW."assetTypeId" AND "eventId" = NEW."eventId";
  IF typeMode = 'SERIALIZED' AND NEW."quantityTotal" <> 1 THEN
    RAISE EXCEPTION 'A serialized asset is exactly one item.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."eventId" IS DISTINCT FROM OLD."eventId" OR NEW."assetTypeId" IS DISTINCT FROM OLD."assetTypeId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'An asset''s event, type and creation time cannot change.' USING ERRCODE = '23001';
    END IF;
    IF NEW."quantityTotal" < OLD."quantityTotal" THEN
      SELECT COALESCE(SUM("quantity"), 0) INTO held FROM "AssetIssuance" WHERE "assetId" = NEW."id" AND "endedAt" IS NULL;
      IF held > NEW."quantityTotal" THEN
        RAISE EXCEPTION 'The lot cannot be smaller than what is already issued.' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "IssuedAsset_guard" BEFORE INSERT OR UPDATE ON "IssuedAsset" FOR EACH ROW EXECUTE FUNCTION "IssuedAsset_guard"();

-- Issuances: a positive quantity (one for a serialized asset), a purpose, ordered times, an end that carries its
-- reason and actor together, and holder columns that match the kind.
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_quantity" CHECK ("quantity" >= 1 AND (NOT "serialized" OR "quantity" = 1));
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_purpose_present" CHECK (length(btrim("purpose")) > 0);
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_revision_positive" CHECK ("revision" >= 1);
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_expected_return_after_issue" CHECK ("expectedReturnAt" IS NULL OR "expectedReturnAt" >= "issuedAt");
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_ended_after_issued" CHECK ("endedAt" IS NULL OR "endedAt" >= "issuedAt");
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_end_fields" CHECK (
  ("endedAt" IS NULL) = ("endReason" IS NULL) AND ("endedAt" IS NULL) = ("endedByUserId" IS NULL)
);
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_holder_matches_kind" CHECK (
  CASE "assigneeKind"
    WHEN 'ATTENDEE' THEN "attendeeId" IS NOT NULL AND "registrationId" IS NULL AND "staffUserId" IS NULL AND "assigneeLabel" IS NULL
    WHEN 'REGISTRATION' THEN "registrationId" IS NOT NULL AND "attendeeId" IS NULL AND "staffUserId" IS NULL AND "assigneeLabel" IS NULL
    WHEN 'STAFF' THEN "staffUserId" IS NOT NULL AND "attendeeId" IS NULL AND "registrationId" IS NULL AND "assigneeLabel" IS NULL AND "roomUnitId" IS NULL AND "sourceAssignmentId" IS NULL
    WHEN 'ROOM' THEN "roomUnitId" IS NOT NULL AND "attendeeId" IS NULL AND "registrationId" IS NULL AND "staffUserId" IS NULL AND "assigneeLabel" IS NULL
    ELSE length(btrim(COALESCE("assigneeLabel", ''))) > 0 AND "attendeeId" IS NULL AND "registrationId" IS NULL AND "staffUserId" IS NULL AND "roomUnitId" IS NULL AND "sourceAssignmentId" IS NULL
  END
);
-- A source assignment always comes with the room it put the holder in.
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_source_has_room" CHECK ("sourceAssignmentId" IS NULL OR "roomUnitId" IS NOT NULL);

-- A serialized asset has at most one open issuance, whatever the code path.
CREATE UNIQUE INDEX "AssetIssuance_serialized_open_key" ON "AssetIssuance"("assetId") WHERE "endedAt" IS NULL AND "serialized";

-- A new issuance: the attendee and registration belong to its event, the snapshot matches the type's mode, the asset
-- is in stock, and open quantities never exceed the lot (the asset row is locked first, so racing writers queue).
-- An update may only end an open issuance.
CREATE FUNCTION "AssetIssuance_before_write"() RETURNS trigger AS $$
DECLARE
  assetRow "IssuedAsset"%ROWTYPE;
  typeMode "IssuedAssetMode";
  held integer;
BEGIN
  IF NEW."attendeeId" IS NOT NULL AND (SELECT "eventId" FROM "RegistrationAttendee" WHERE "id" = NEW."attendeeId") IS DISTINCT FROM NEW."eventId" THEN
    RAISE EXCEPTION 'The attendee is not on the issuance''s event.' USING ERRCODE = '23001';
  END IF;
  IF NEW."registrationId" IS NOT NULL AND (SELECT "eventId" FROM "Registration" WHERE "id" = NEW."registrationId") IS DISTINCT FROM NEW."eventId" THEN
    RAISE EXCEPTION 'The registration is not on the issuance''s event.' USING ERRCODE = '23001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."endedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'An ended issuance never changes.' USING ERRCODE = '23001';
    END IF;
    IF NEW."revision" <= OLD."revision" THEN
      RAISE EXCEPTION 'Every change to an issuance raises its revision.' USING ERRCODE = '23001';
    END IF;
    IF NEW."endedAt" IS NULL THEN
      RAISE EXCEPTION 'An issuance changes only to end.' USING ERRCODE = '23001';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['endedAt', 'endReason', 'endedByUserId', 'endNote', 'revision', 'updatedAt'])
       <> (to_jsonb(OLD) - ARRAY['endedAt', 'endReason', 'endedByUserId', 'endNote', 'revision', 'updatedAt']) THEN
      RAISE EXCEPTION 'An issuance changes only to end; who, what and when are never rewritten.' USING ERRCODE = '23001';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO assetRow FROM "IssuedAsset" WHERE "id" = NEW."assetId" AND "eventId" = NEW."eventId" FOR UPDATE;
  SELECT "mode" INTO typeMode FROM "IssuedAssetType" WHERE "id" = assetRow."assetTypeId";
  IF (typeMode = 'SERIALIZED') IS DISTINCT FROM NEW."serialized" THEN
    RAISE EXCEPTION 'The issuance does not match the asset type''s serialized or quantity behaviour.' USING ERRCODE = '23514';
  END IF;
  IF NEW."endedAt" IS NULL THEN
    IF assetRow."availability" <> 'AVAILABLE' THEN
      RAISE EXCEPTION 'That asset is not available to issue.' USING ERRCODE = '23514';
    END IF;
    IF NOT NEW."serialized" THEN
      SELECT COALESCE(SUM("quantity"), 0) INTO held FROM "AssetIssuance" WHERE "assetId" = NEW."assetId" AND "endedAt" IS NULL;
      IF held + NEW."quantity" > assetRow."quantityTotal" THEN
        RAISE EXCEPTION 'Not enough left to issue: % of % already out.', held, assetRow."quantityTotal" USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AssetIssuance_before_write" BEFORE INSERT OR UPDATE ON "AssetIssuance" FOR EACH ROW EXECUTE FUNCTION "AssetIssuance_before_write"();

-- Every issuance change appends its history row in the same transaction (checked at commit).
CREATE FUNCTION "AssetIssuance_requires_history"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "AssetIssuanceHistory" WHERE "issuanceId" = NEW."id" AND "revision" = NEW."revision") THEN
    RAISE EXCEPTION 'Every change to an issuance must append its history row.' USING ERRCODE = '23001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "AssetIssuance_requires_history" AFTER INSERT OR UPDATE ON "AssetIssuance" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "AssetIssuance_requires_history"();

-- History is append-only.
ALTER TABLE "AssetIssuanceHistory" ADD CONSTRAINT "AssetIssuanceHistory_positive" CHECK ("revision" >= 1 AND "quantity" >= 1);
CREATE FUNCTION "AssetIssuanceHistory_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Issued-asset history is append-only.' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AssetIssuanceHistory_append_only" BEFORE UPDATE ON "AssetIssuanceHistory" FOR EACH ROW EXECUTE FUNCTION "AssetIssuanceHistory_append_only"();
