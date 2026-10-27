-- Registration ledger, slice 1 (#117, parent #74). ADDITIVE ONLY: four enums, one new table, its indexes and keys, a sign
-- check and an append-only trigger. No existing table or column is touched, so the code from before this deploy keeps
-- working against the new schema. Shadow mode: nothing reads these rows yet and "Registration"."totalAmount" stays
-- authoritative. Applying it in production is a human step (back up first); the backfill is a separate script run by hand.

-- CreateEnum
CREATE TYPE "RegistrationLedgerEntryKind" AS ENUM ('CHARGE', 'DISCOUNT', 'CREDIT');

-- CreateEnum
CREATE TYPE "RegistrationLedgerSourceType" AS ENUM ('REGISTRATION_SUBMISSION', 'AMENDMENT', 'PROMO_REDEMPTION');

-- CreateEnum
CREATE TYPE "RegistrationLedgerOrigin" AS ENUM ('LIVE', 'BACKFILL');

-- CreateEnum
CREATE TYPE "RegistrationLedgerActorType" AS ENUM ('SYSTEM', 'STAFF', 'ATTENDEE_ACCOUNT', 'PERSON');

-- CreateTable
CREATE TABLE "RegistrationLedgerEntry" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "kind" "RegistrationLedgerEntryKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "pricingSnapshot" JSONB NOT NULL,
    "sourceType" "RegistrationLedgerSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "origin" "RegistrationLedgerOrigin" NOT NULL DEFAULT 'LIVE',
    "actorType" "RegistrationLedgerActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "actorNameSnapshot" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistrationLedgerEntry_registrationId_createdAt_idx" ON "RegistrationLedgerEntry"("registrationId", "createdAt");

-- CreateIndex
CREATE INDEX "RegistrationLedgerEntry_eventId_idx" ON "RegistrationLedgerEntry"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationLedgerEntry_sourceType_sourceId_kind_key" ON "RegistrationLedgerEntry"("sourceType", "sourceId", "kind");

-- AddForeignKey
ALTER TABLE "RegistrationLedgerEntry" ADD CONSTRAINT "RegistrationLedgerEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationLedgerEntry" ADD CONSTRAINT "RegistrationLedgerEntry_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A charge never lowers what is owed, a discount or credit never raises it, so the total is a plain sum.
ALTER TABLE "RegistrationLedgerEntry" ADD CONSTRAINT "RegistrationLedgerEntry_amount_sign_check" CHECK (
  ("kind" = 'CHARGE' AND "amountCents" >= 0)
  OR ("kind" IN ('DISCOUNT', 'CREDIT') AND "amountCents" <= 0)
);

-- Append-only: an UPDATE is always refused. A DELETE is refused unless it is the foreign key's own cascade from a deleted
-- registration or event: that runs inside the referential-integrity trigger, so pg_trigger_depth() is above 1 here. A
-- direct DELETE runs at depth 1. TRUNCATE is not covered by a row trigger and is not used by the application.
CREATE OR REPLACE FUNCTION "reject_registration_ledger_entry_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'RegistrationLedgerEntry rows are append-only';
END;
$$;

CREATE TRIGGER "RegistrationLedgerEntry_append_only"
BEFORE UPDATE OR DELETE ON "RegistrationLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "reject_registration_ledger_entry_mutation"();
