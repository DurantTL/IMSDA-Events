-- Reviewed exceptions and cash handed back after a correction (#214 review). Additive: two enum values, two rewritten
-- constraints (they compare the enum as text, because a value added in this migration cannot be used until it commits)
-- and one replaced guard function.

-- AlterEnum
ALTER TYPE "AssetLedgerKind" ADD VALUE 'DEPOSIT_HANDED_BACK_LATE';

-- AlterEnum
ALTER TYPE "IssuedAssetEventType" ADD VALUE 'EXCEPTION_REVIEWED';

-- One shape per kind of ledger entry, now with the late hand-back.
ALTER TABLE "AssetLedgerEntry" DROP CONSTRAINT "AssetLedgerEntry_kind_shape";
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_kind_shape" CHECK (
  CASE "kind"::text
    WHEN 'DEPOSIT_RECEIVED' THEN "depositEntryId" IS NULL AND "waivesEntryId" IS NULL AND "chargeCategory" IS NULL AND "settlement" = 'CASH_AT_DESK' AND "assetTypeId" IS NOT NULL
    WHEN 'DEPOSIT_RETURNED' THEN "depositEntryId" IS NOT NULL AND "waivesEntryId" IS NULL AND "chargeCategory" IS NULL AND "settlement" = 'CASH_AT_DESK'
    WHEN 'DEPOSIT_KEPT' THEN "depositEntryId" IS NOT NULL AND "waivesEntryId" IS NULL AND "chargeCategory" IS NULL AND "settlement" = 'CASH_AT_DESK'
    WHEN 'DEPOSIT_HANDED_BACK_LATE' THEN "depositEntryId" IS NOT NULL AND "waivesEntryId" IS NULL AND "chargeCategory" IS NULL AND "settlement" = 'CASH_AT_DESK'
    WHEN 'CHARGE' THEN "depositEntryId" IS NULL AND "waivesEntryId" IS NULL AND "chargeCategory" IS NOT NULL AND "settlement" <> 'CASH_AT_DESK' AND "issuanceId" IS NOT NULL
    ELSE "waivesEntryId" IS NOT NULL AND "depositEntryId" IS NULL AND "chargeCategory" IS NULL AND "settlement" <> 'CASH_AT_DESK'
  END
);

-- A late hand-back never exceeds what the deposit kept.
CREATE OR REPLACE FUNCTION "AssetLedgerEntry_guard"() RETURNS trigger AS $$
DECLARE
  target "AssetLedgerEntry"%ROWTYPE;
  settled integer;
  late integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Issued-asset money entries are append-only.' USING ERRCODE = '23001';
  END IF;
  IF NEW."registrationId" IS NOT NULL AND (SELECT "eventId" FROM "Registration" WHERE "id" = NEW."registrationId") IS DISTINCT FROM NEW."eventId" THEN
    RAISE EXCEPTION 'The registration is not on the entry''s event.' USING ERRCODE = '23001';
  END IF;
  IF NEW."kind"::text IN ('DEPOSIT_RETURNED', 'DEPOSIT_KEPT') THEN
    SELECT * INTO target FROM "AssetLedgerEntry" WHERE "id" = NEW."depositEntryId" AND "eventId" = NEW."eventId" FOR UPDATE;
    IF target."kind"::text IS DISTINCT FROM 'DEPOSIT_RECEIVED' THEN
      RAISE EXCEPTION 'A deposit return or keep must point at a received deposit.' USING ERRCODE = '23001';
    END IF;
    SELECT COALESCE(SUM("amountCents"), 0) INTO settled FROM "AssetLedgerEntry" WHERE "depositEntryId" = NEW."depositEntryId" AND "kind"::text IN ('DEPOSIT_RETURNED', 'DEPOSIT_KEPT');
    IF settled + NEW."amountCents" > target."amountCents" THEN
      RAISE EXCEPTION 'More than the deposit received would be handed back or kept.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."kind"::text = 'DEPOSIT_HANDED_BACK_LATE' THEN
    SELECT * INTO target FROM "AssetLedgerEntry" WHERE "id" = NEW."depositEntryId" AND "eventId" = NEW."eventId" FOR UPDATE;
    IF target."kind"::text IS DISTINCT FROM 'DEPOSIT_RECEIVED' THEN
      RAISE EXCEPTION 'A late hand-back must point at a received deposit.' USING ERRCODE = '23001';
    END IF;
    SELECT COALESCE(SUM("amountCents"), 0) INTO settled FROM "AssetLedgerEntry" WHERE "depositEntryId" = NEW."depositEntryId" AND "kind"::text = 'DEPOSIT_KEPT';
    SELECT COALESCE(SUM("amountCents"), 0) INTO late FROM "AssetLedgerEntry" WHERE "depositEntryId" = NEW."depositEntryId" AND "kind"::text = 'DEPOSIT_HANDED_BACK_LATE';
    IF late + NEW."amountCents" > settled THEN
      RAISE EXCEPTION 'More than the deposit kept would be handed back.' USING ERRCODE = '23514';
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

-- A corrected outcome, a write-off and a review each carry a reason; only a correction carries a fate.
ALTER TABLE "AssetIssuanceHistory" DROP CONSTRAINT "AssetIssuanceHistory_corrected_fate";
ALTER TABLE "AssetIssuanceHistory" ADD CONSTRAINT "AssetIssuanceHistory_corrected_fate" CHECK (
  ("type"::text = 'OUTCOME_CORRECTED') = ("correctedEndReason" IS NOT NULL)
  AND ("correctedEndReason" IS NULL OR "correctedEndReason"::text IN ('RETURNED', 'LOST', 'DAMAGED'))
  AND ("type"::text NOT IN ('OUTCOME_CORRECTED', 'WRITTEN_OFF', 'EXCEPTION_REVIEWED') OR length(btrim(COALESCE("reason", ''))) > 0)
);
