-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IssuedAssetEventType" ADD VALUE 'OUTCOME_CORRECTED';
ALTER TYPE "IssuedAssetEventType" ADD VALUE 'WRITTEN_OFF';

-- AlterTable
ALTER TABLE "AssetIssuanceHistory" ADD COLUMN     "correctedEndReason" "IssuedAssetEndReason";

-- AlterTable
ALTER TABLE "AssetLedgerEntry" ADD COLUMN     "depositOffsetCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "depositShortfallSnapshot" "AssetDepositShortfall",
ADD COLUMN     "replacementFeeSnapshotCents" INTEGER;



-- ---------------------------------------------------------------------------
-- Corrections, written-off losses, deposit terms snapshots and charge offsets (#214 review). Additive.
-- ---------------------------------------------------------------------------

-- Rows that predate these columns (none outside development) are not re-checked; the ledger cannot be updated to backfill them.
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_deposit_terms" CHECK (
  ("kind"::text <> 'DEPOSIT_RECEIVED' OR ("depositShortfallSnapshot" IS NOT NULL AND "replacementFeeSnapshotCents" IS NOT NULL AND "replacementFeeSnapshotCents" >= 0))
  AND "depositOffsetCents" >= 0 AND ("kind"::text = 'CHARGE' OR "depositOffsetCents" = 0)
) NOT VALID;

-- Keeping the replacement fee needs a fee to keep.
ALTER TABLE "IssuedAssetType" ADD CONSTRAINT "IssuedAssetType_keep_fees_needs_fee" CHECK ("depositShortfall"::text <> 'KEEP_FEES' OR "replacementFeeCents" > 0) NOT VALID;

-- A corrected outcome says what the fate now is; no other history row does.
ALTER TABLE "AssetIssuanceHistory" ADD CONSTRAINT "AssetIssuanceHistory_corrected_fate" CHECK (
  ("type"::text = 'OUTCOME_CORRECTED') = ("correctedEndReason" IS NOT NULL)
  AND ("correctedEndReason" IS NULL OR "correctedEndReason"::text IN ('RETURNED', 'LOST', 'DAMAGED'))
  AND ("type"::text NOT IN ('OUTCOME_CORRECTED', 'WRITTEN_OFF') OR length(btrim(COALESCE("reason", ''))) > 0)
);
