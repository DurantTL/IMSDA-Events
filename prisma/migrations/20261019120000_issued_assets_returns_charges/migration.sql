-- CreateEnum
CREATE TYPE "AssetDepositShortfall" AS ENUM ('KEEP_ALL', 'KEEP_FEES');

-- CreateEnum
CREATE TYPE "AssetLedgerKind" AS ENUM ('DEPOSIT_RECEIVED', 'DEPOSIT_RETURNED', 'DEPOSIT_KEPT', 'CHARGE', 'WAIVER');

-- CreateEnum
CREATE TYPE "AssetChargeCategory" AS ENUM ('REPLACEMENT', 'DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetLedgerSettlement" AS ENUM ('CASH_AT_DESK', 'REGISTRATION_ADJUSTMENT', 'RECORD_ONLY');

-- CreateEnum
CREATE TYPE "FacilityTargetKind" AS ENUM ('UNIT', 'ASSET', 'OTHER');

-- CreateEnum
CREATE TYPE "FacilityIssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FacilityIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FacilityIssueSource" AS ENUM ('REPORT', 'CHECKOUT_INSPECTION');

-- CreateEnum
CREATE TYPE "FacilityIssueHistoryType" AS ENUM ('REPORTED', 'UPDATED', 'BLOCK_PLACED', 'RESOLVED', 'DISMISSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IssuedAssetEndReason" ADD VALUE 'RETURNED';
ALTER TYPE "IssuedAssetEndReason" ADD VALUE 'LOST';
ALTER TYPE "IssuedAssetEndReason" ADD VALUE 'DAMAGED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IssuedAssetEventType" ADD VALUE 'RETURNED';
ALTER TYPE "IssuedAssetEventType" ADD VALUE 'LOST';
ALTER TYPE "IssuedAssetEventType" ADD VALUE 'DAMAGED';
ALTER TYPE "IssuedAssetEventType" ADD VALUE 'REMAINDER_ISSUED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LodgingHoldKind" ADD VALUE 'SAFETY';
ALTER TYPE "LodgingHoldKind" ADD VALUE 'DAMAGE';

-- AlterEnum
ALTER TYPE "RegistrationAdjustmentKind" ADD VALUE 'ASSET';

-- AlterTable
ALTER TABLE "AssetIssuance" ADD COLUMN     "endQuantity" INTEGER;

-- AlterTable
ALTER TABLE "AssetIssuanceHistory" ADD COLUMN     "condition" "IssuedAssetCondition",
ADD COLUMN     "evidenceRef" TEXT,
ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "IssuedAssetType" ADD COLUMN     "depositCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "depositShortfall" "AssetDepositShortfall" NOT NULL DEFAULT 'KEEP_ALL',
ADD COLUMN     "replacementFeeCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AssetLedgerEntry" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "AssetLedgerKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "assetTypeId" TEXT,
    "issuanceId" TEXT,
    "registrationId" TEXT,
    "depositEntryId" TEXT,
    "waivesEntryId" TEXT,
    "chargeCategory" "AssetChargeCategory",
    "settlement" "AssetLedgerSettlement" NOT NULL,
    "registrationAdjustmentId" TEXT,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorNameSnapshot" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDepositCover" (
    "issuanceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "depositEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetDepositCover_pkey" PRIMARY KEY ("issuanceId")
);

-- CreateTable
CREATE TABLE "FacilityIssue" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "targetKind" "FacilityTargetKind" NOT NULL,
    "eventUnitId" TEXT,
    "assetId" TEXT,
    "targetLabel" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "FacilityIssueSeverity" NOT NULL,
    "status" "FacilityIssueStatus" NOT NULL DEFAULT 'OPEN',
    "source" "FacilityIssueSource" NOT NULL,
    "sourceIssuanceId" TEXT,
    "assigneeUserId" TEXT,
    "resolution" TEXT,
    "holdId" TEXT,
    "reportedByUserId" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityIssueHistory" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "type" "FacilityIssueHistoryType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT NOT NULL,
    "status" "FacilityIssueStatus" NOT NULL,
    "severity" "FacilityIssueSeverity" NOT NULL,
    "assigneeUserId" TEXT,
    "note" TEXT,
    "holdId" TEXT,
    "revision" INTEGER NOT NULL,

    CONSTRAINT "FacilityIssueHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetLedgerEntry_registrationAdjustmentId_key" ON "AssetLedgerEntry"("registrationAdjustmentId");

-- CreateIndex
CREATE INDEX "AssetLedgerEntry_eventId_createdAt_idx" ON "AssetLedgerEntry"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetLedgerEntry_registrationId_createdAt_idx" ON "AssetLedgerEntry"("registrationId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetLedgerEntry_issuanceId_idx" ON "AssetLedgerEntry"("issuanceId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetLedgerEntry_eventId_idempotencyKey_key" ON "AssetLedgerEntry"("eventId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssetLedgerEntry_id_eventId_key" ON "AssetLedgerEntry"("id", "eventId");

-- CreateIndex
CREATE INDEX "AssetDepositCover_depositEntryId_idx" ON "AssetDepositCover"("depositEntryId");

-- CreateIndex
CREATE INDEX "FacilityIssue_eventId_status_idx" ON "FacilityIssue"("eventId", "status");

-- CreateIndex
CREATE INDEX "FacilityIssue_eventUnitId_idx" ON "FacilityIssue"("eventUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityIssue_id_eventId_key" ON "FacilityIssue"("id", "eventId");

-- CreateIndex
CREATE INDEX "FacilityIssueHistory_issueId_at_idx" ON "FacilityIssueHistory"("issueId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "AssetIssuanceHistory_eventId_idempotencyKey_key" ON "AssetIssuanceHistory"("eventId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_assetTypeId_eventId_fkey" FOREIGN KEY ("assetTypeId", "eventId") REFERENCES "IssuedAssetType"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_issuanceId_eventId_fkey" FOREIGN KEY ("issuanceId", "eventId") REFERENCES "AssetIssuance"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_registrationAdjustmentId_fkey" FOREIGN KEY ("registrationAdjustmentId") REFERENCES "RegistrationAdjustment"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_depositEntryId_eventId_fkey" FOREIGN KEY ("depositEntryId", "eventId") REFERENCES "AssetLedgerEntry"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_waivesEntryId_eventId_fkey" FOREIGN KEY ("waivesEntryId", "eventId") REFERENCES "AssetLedgerEntry"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDepositCover" ADD CONSTRAINT "AssetDepositCover_issuanceId_eventId_fkey" FOREIGN KEY ("issuanceId", "eventId") REFERENCES "AssetIssuance"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDepositCover" ADD CONSTRAINT "AssetDepositCover_depositEntryId_eventId_fkey" FOREIGN KEY ("depositEntryId", "eventId") REFERENCES "AssetLedgerEntry"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityIssue" ADD CONSTRAINT "FacilityIssue_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityIssue" ADD CONSTRAINT "FacilityIssue_eventUnitId_eventId_fkey" FOREIGN KEY ("eventUnitId", "eventId") REFERENCES "EventLodgingUnit"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityIssue" ADD CONSTRAINT "FacilityIssue_assetId_eventId_fkey" FOREIGN KEY ("assetId", "eventId") REFERENCES "IssuedAsset"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityIssue" ADD CONSTRAINT "FacilityIssue_holdId_eventId_fkey" FOREIGN KEY ("holdId", "eventId") REFERENCES "EventLodgingHold"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityIssueHistory" ADD CONSTRAINT "FacilityIssueHistory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityIssueHistory" ADD CONSTRAINT "FacilityIssueHistory_issueId_eventId_fkey" FOREIGN KEY ("issueId", "eventId") REFERENCES "FacilityIssue"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Constraints and triggers Prisma cannot express (#214). Additive: new tables and columns, new enum values, and one
-- replaced function (`AssetIssuance_before_write`, which now also lets `endQuantity` be written when an issuance ends).
-- Money entries and facility history are append-only; nothing here is ever deleted while the event exists.
-- ---------------------------------------------------------------------------

-- Types: the deposit and replacement fee are cents, never negative.
ALTER TABLE "IssuedAssetType" ADD CONSTRAINT "IssuedAssetType_money_range" CHECK (
  "depositCents" BETWEEN 0 AND 10000000 AND "replacementFeeCents" BETWEEN 0 AND 10000000
);

-- Issuances: how many of a lot an ending outcome covers. A return, loss or damage carries it; every other end does not.
ALTER TABLE "AssetIssuance" ADD CONSTRAINT "AssetIssuance_end_quantity" CHECK ("endQuantity" IS NULL OR ("endQuantity" >= 1 AND "endQuantity" <= "quantity"));

CREATE OR REPLACE FUNCTION "AssetIssuance_before_write"() RETURNS trigger AS $$
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
    IF (to_jsonb(NEW) - ARRAY['endedAt', 'endReason', 'endedByUserId', 'endNote', 'endQuantity', 'revision', 'updatedAt'])
       <> (to_jsonb(OLD) - ARRAY['endedAt', 'endReason', 'endedByUserId', 'endNote', 'endQuantity', 'revision', 'updatedAt']) THEN
      RAISE EXCEPTION 'An issuance changes only to end; who, what and when are never rewritten.' USING ERRCODE = '23001';
    END IF;
    IF (NEW."endReason"::text IN ('RETURNED', 'LOST', 'DAMAGED')) <> (NEW."endQuantity" IS NOT NULL) THEN
      RAISE EXCEPTION 'A return, loss or damage says how many it covers, and no other end does.' USING ERRCODE = '23514';
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

-- ---------------------------------------------------------------------------
-- The asset money ledger: append-only, one shape per kind, and references that make sense.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "AssetLedgerEntry_no_delete" BEFORE DELETE ON "AssetLedgerEntry" FOR EACH ROW EXECUTE FUNCTION "IssuedAsset_refuse_delete"();
CREATE TRIGGER "AssetDepositCover_no_delete" BEFORE DELETE ON "AssetDepositCover" FOR EACH ROW EXECUTE FUNCTION "IssuedAsset_refuse_delete"();
CREATE TRIGGER "FacilityIssue_no_delete" BEFORE DELETE ON "FacilityIssue" FOR EACH ROW EXECUTE FUNCTION "IssuedAsset_refuse_delete"();
CREATE TRIGGER "FacilityIssueHistory_no_delete" BEFORE DELETE ON "FacilityIssueHistory" FOR EACH ROW EXECUTE FUNCTION "IssuedAsset_refuse_delete"();

ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_amount_range" CHECK ("amountCents" >= 1 AND "amountCents" <= 10000000);
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_reason_present" CHECK (length(btrim("reason")) > 0 AND length(btrim("actorNameSnapshot")) > 0);
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_kind_shape" CHECK (
  CASE "kind"
    WHEN 'DEPOSIT_RECEIVED' THEN "depositEntryId" IS NULL AND "waivesEntryId" IS NULL AND "chargeCategory" IS NULL AND "settlement" = 'CASH_AT_DESK' AND "assetTypeId" IS NOT NULL
    WHEN 'DEPOSIT_RETURNED' THEN "depositEntryId" IS NOT NULL AND "waivesEntryId" IS NULL AND "chargeCategory" IS NULL AND "settlement" = 'CASH_AT_DESK'
    WHEN 'DEPOSIT_KEPT' THEN "depositEntryId" IS NOT NULL AND "waivesEntryId" IS NULL AND "chargeCategory" IS NULL AND "settlement" = 'CASH_AT_DESK'
    WHEN 'CHARGE' THEN "depositEntryId" IS NULL AND "waivesEntryId" IS NULL AND "chargeCategory" IS NOT NULL AND "settlement" <> 'CASH_AT_DESK' AND "issuanceId" IS NOT NULL
    ELSE "waivesEntryId" IS NOT NULL AND "depositEntryId" IS NULL AND "chargeCategory" IS NULL AND "settlement" <> 'CASH_AT_DESK'
  END
);
-- A line posted to the registration needs the registration, and only a posted entry carries a line.
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_settlement_line" CHECK (
  ("settlement" = 'REGISTRATION_ADJUSTMENT') = ("registrationAdjustmentId" IS NOT NULL)
  AND ("registrationAdjustmentId" IS NULL OR "registrationId" IS NOT NULL)
);

-- One charge per category per issuance; one waiver per charge; a deposit settles once per direction.
CREATE UNIQUE INDEX "AssetLedgerEntry_one_charge_per_category" ON "AssetLedgerEntry"("issuanceId", "chargeCategory") WHERE "kind" = 'CHARGE';
CREATE UNIQUE INDEX "AssetLedgerEntry_one_waiver_per_charge" ON "AssetLedgerEntry"("waivesEntryId") WHERE "kind" = 'WAIVER';
CREATE UNIQUE INDEX "AssetLedgerEntry_one_settlement_per_kind" ON "AssetLedgerEntry"("depositEntryId", "kind") WHERE "kind" IN ('DEPOSIT_RETURNED', 'DEPOSIT_KEPT');

CREATE FUNCTION "AssetLedgerEntry_guard"() RETURNS trigger AS $$
DECLARE
  target "AssetLedgerEntry"%ROWTYPE;
  settled integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Issued-asset money entries are append-only.' USING ERRCODE = '23001';
  END IF;
  IF NEW."registrationId" IS NOT NULL AND (SELECT "eventId" FROM "Registration" WHERE "id" = NEW."registrationId") IS DISTINCT FROM NEW."eventId" THEN
    RAISE EXCEPTION 'The registration is not on the entry''s event.' USING ERRCODE = '23001';
  END IF;
  IF NEW."kind"::text IN ('DEPOSIT_RETURNED', 'DEPOSIT_KEPT') THEN
    -- Lock the deposit so two settlements of it queue, then keep what is handed back or kept within what was received.
    SELECT * INTO target FROM "AssetLedgerEntry" WHERE "id" = NEW."depositEntryId" AND "eventId" = NEW."eventId" FOR UPDATE;
    IF target."kind"::text IS DISTINCT FROM 'DEPOSIT_RECEIVED' THEN
      RAISE EXCEPTION 'A deposit return or keep must point at a received deposit.' USING ERRCODE = '23001';
    END IF;
    SELECT COALESCE(SUM("amountCents"), 0) INTO settled FROM "AssetLedgerEntry" WHERE "depositEntryId" = NEW."depositEntryId";
    IF settled + NEW."amountCents" > target."amountCents" THEN
      RAISE EXCEPTION 'More than the deposit received would be handed back or kept.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."kind"::text = 'WAIVER' THEN
    SELECT * INTO target FROM "AssetLedgerEntry" WHERE "id" = NEW."waivesEntryId" AND "eventId" = NEW."eventId" FOR UPDATE;
    IF target."kind"::text IS DISTINCT FROM 'CHARGE' THEN
      RAISE EXCEPTION 'A waiver must point at a charge.' USING ERRCODE = '23001';
    END IF;
    IF NEW."amountCents" <> target."amountCents" THEN
      RAISE EXCEPTION 'A waiver covers the whole charge.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AssetLedgerEntry_guard" BEFORE INSERT OR UPDATE ON "AssetLedgerEntry" FOR EACH ROW EXECUTE FUNCTION "AssetLedgerEntry_guard"();

-- A deposit covers issuances of its own event and only a received deposit covers anything. Insert-only.
CREATE FUNCTION "AssetDepositCover_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A deposit''s coverage is never rewritten.' USING ERRCODE = '23001';
  END IF;
  IF (SELECT "kind"::text FROM "AssetLedgerEntry" WHERE "id" = NEW."depositEntryId" AND "eventId" = NEW."eventId") IS DISTINCT FROM 'DEPOSIT_RECEIVED' THEN
    RAISE EXCEPTION 'Only a received deposit covers issuances.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AssetDepositCover_guard" BEFORE INSERT OR UPDATE ON "AssetDepositCover" FOR EACH ROW EXECUTE FUNCTION "AssetDepositCover_guard"();

-- ---------------------------------------------------------------------------
-- Facility issues: a ticket whose every change appends a snapshot; a finished one never changes again.
-- ---------------------------------------------------------------------------

ALTER TABLE "FacilityIssue" ADD CONSTRAINT "FacilityIssue_title_present" CHECK (length(btrim("title")) > 0);
ALTER TABLE "FacilityIssue" ADD CONSTRAINT "FacilityIssue_revision_positive" CHECK ("revision" >= 1);
ALTER TABLE "FacilityIssue" ADD CONSTRAINT "FacilityIssue_target_shape" CHECK (
  CASE "targetKind"
    WHEN 'UNIT' THEN "eventUnitId" IS NOT NULL AND "assetId" IS NULL
    WHEN 'ASSET' THEN "assetId" IS NOT NULL AND "eventUnitId" IS NULL
    ELSE length(btrim(COALESCE("targetLabel", ''))) > 0 AND "eventUnitId" IS NULL AND "assetId" IS NULL
  END
);
ALTER TABLE "FacilityIssue" ADD CONSTRAINT "FacilityIssue_finished_fields" CHECK (
  ("status"::text IN ('RESOLVED', 'DISMISSED')) = ("resolvedAt" IS NOT NULL)
  AND ("resolvedAt" IS NULL) = ("resolvedByUserId" IS NULL)
  AND ("status"::text NOT IN ('RESOLVED', 'DISMISSED') OR length(btrim(COALESCE("resolution", ''))) > 0)
);

CREATE FUNCTION "FacilityIssue_guard"() RETURNS trigger AS $$
DECLARE
  changeable CONSTANT text[] := ARRAY['severity', 'status', 'assigneeUserId', 'resolution', 'holdId', 'resolvedAt', 'resolvedByUserId', 'description', 'revision', 'updatedAt'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status"::text IN ('RESOLVED', 'DISMISSED') THEN
      RAISE EXCEPTION 'A facility issue starts open.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status"::text IN ('RESOLVED', 'DISMISSED') THEN
    RAISE EXCEPTION 'A finished facility issue never changes; report a new one.' USING ERRCODE = '23001';
  END IF;
  IF NEW."revision" <= OLD."revision" THEN
    RAISE EXCEPTION 'Every change to a facility issue raises its revision.' USING ERRCODE = '23001';
  END IF;
  IF (to_jsonb(NEW) - changeable) <> (to_jsonb(OLD) - changeable) THEN
    RAISE EXCEPTION 'A facility issue''s target, source and reporter are never rewritten.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FacilityIssue_guard" BEFORE INSERT OR UPDATE ON "FacilityIssue" FOR EACH ROW EXECUTE FUNCTION "FacilityIssue_guard"();

-- Every change appends its history row in the same transaction (checked at commit).
CREATE FUNCTION "FacilityIssue_requires_history"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "FacilityIssueHistory" WHERE "issueId" = NEW."id" AND "revision" = NEW."revision") THEN
    RAISE EXCEPTION 'Every change to a facility issue must append its history row.' USING ERRCODE = '23001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "FacilityIssue_requires_history" AFTER INSERT OR UPDATE ON "FacilityIssue" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "FacilityIssue_requires_history"();

CREATE FUNCTION "FacilityIssueHistory_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Facility issue history is append-only.' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FacilityIssueHistory_append_only" BEFORE UPDATE ON "FacilityIssueHistory" FOR EACH ROW EXECUTE FUNCTION "FacilityIssueHistory_append_only"();
ALTER TABLE "FacilityIssueHistory" ADD CONSTRAINT "FacilityIssueHistory_revision_positive" CHECK ("revision" >= 1);
