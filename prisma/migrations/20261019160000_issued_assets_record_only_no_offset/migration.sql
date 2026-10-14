-- A charge that was only recorded (no registration adjustment) never counts against a kept deposit (#214 review).
-- "AssetDeposit_held" subtracts the offsets of posted charges only, so an offset on a record-only charge would let the same kept
-- money be claimed twice. Additive; NOT VALID so rows from earlier builds are not re-checked.
ALTER TABLE "AssetLedgerEntry" ADD CONSTRAINT "AssetLedgerEntry_offset_needs_posting" CHECK (
  "depositOffsetCents" = 0 OR "kind"::text <> 'CHARGE' OR "registrationAdjustmentId" IS NOT NULL
) NOT VALID;
