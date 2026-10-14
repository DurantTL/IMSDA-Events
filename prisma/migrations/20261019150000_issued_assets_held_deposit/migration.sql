-- One definition of how much of a deposit is still held, enforced by the database (#214 review). Additive.
-- A review names the exception it answers, and a history row records the stock change it made to a lot.

-- AlterTable
ALTER TABLE "AssetIssuanceHistory" ADD COLUMN     "reviewedCode" TEXT,
ADD COLUMN     "reviewedRefId" TEXT,
ADD COLUMN     "stockDelta" INTEGER NOT NULL DEFAULT 0;

-- A review says which exception it answers (rows that predate the column are not re-checked).
ALTER TABLE "AssetIssuanceHistory" ADD CONSTRAINT "AssetIssuanceHistory_review_names_exception" CHECK (
  ("type"::text = 'EXCEPTION_REVIEWED') = ("reviewedCode" IS NOT NULL)
) NOT VALID;
-- A stock change only ever takes units off a lot or puts back what was taken.
ALTER TABLE "AssetIssuanceHistory" ADD CONSTRAINT "AssetIssuanceHistory_stock_delta_kind" CHECK (
  "stockDelta" = 0 OR "type"::text IN ('RETURNED', 'LOST', 'DAMAGED', 'OUTCOME_CORRECTED')
);

-- How much of the money a deposit kept is still held: what it kept, less what was handed back late, less what posted
-- (and not waived) charges on its covered items already counted against it. Never below zero. A waiver restores the offset.
CREATE FUNCTION "AssetDeposit_held"(depositId text) RETURNS integer AS $$
DECLARE
  kept integer;
  late integer;
  offsets integer;
BEGIN
  SELECT COALESCE(SUM("amountCents"), 0) INTO kept FROM "AssetLedgerEntry" WHERE "depositEntryId" = depositId AND "kind"::text = 'DEPOSIT_KEPT';
  SELECT COALESCE(SUM("amountCents"), 0) INTO late FROM "AssetLedgerEntry" WHERE "depositEntryId" = depositId AND "kind"::text = 'DEPOSIT_HANDED_BACK_LATE';
  SELECT COALESCE(SUM(charge."depositOffsetCents"), 0) INTO offsets
  FROM "AssetLedgerEntry" charge
  JOIN "AssetDepositCover" cover ON cover."issuanceId" = charge."issuanceId"
  WHERE cover."depositEntryId" = depositId AND charge."kind"::text = 'CHARGE' AND charge."registrationAdjustmentId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "AssetLedgerEntry" waiver WHERE waiver."waivesEntryId" = charge."id" AND waiver."kind"::text = 'WAIVER');
  RETURN GREATEST(0, kept - late - offsets);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION "AssetLedgerEntry_guard"() RETURNS trigger AS $$
DECLARE
  target "AssetLedgerEntry"%ROWTYPE;
  settled integer;
  coveredBy text;
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
    IF NEW."amountCents" > "AssetDeposit_held"(NEW."depositEntryId") THEN
      RAISE EXCEPTION 'More than is still held of the kept deposit would be handed back.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."kind"::text = 'CHARGE' AND NEW."depositOffsetCents" > 0 THEN
    SELECT "depositEntryId" INTO coveredBy FROM "AssetDepositCover" WHERE "issuanceId" = NEW."issuanceId";
    IF coveredBy IS NULL THEN
      RAISE EXCEPTION 'A charge offset by a kept deposit must be on an item that deposit covers.' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "AssetLedgerEntry" WHERE "id" = coveredBy FOR UPDATE;
    IF NEW."depositOffsetCents" > "AssetDeposit_held"(coveredBy) THEN
      RAISE EXCEPTION 'The charge counts more against the kept deposit than is still held of it.' USING ERRCODE = '23514';
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
