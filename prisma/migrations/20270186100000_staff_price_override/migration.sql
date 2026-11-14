-- Staff price override for one person (#1509). Additive: one adjustment kind and one ledger source type, no new table and no data change. Applying it in production is a human step.

-- AlterEnum
ALTER TYPE "RegistrationAdjustmentKind" ADD VALUE 'PRICE_OVERRIDE';

-- AlterEnum
ALTER TYPE "RegistrationLedgerSourceType" ADD VALUE 'STAFF_PRICE_OVERRIDE';
