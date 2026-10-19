-- Cancellation policy slice 3 (#171): carrying out an approved cancellation request, by a named staff member.
-- Additive only: three enums, two tables, one nullable column on CancellationRequest, and constraints and triggers on the
-- new tables. No existing row is read, moved or changed, and the final-state trigger on CancellationRequest is untouched:
-- execution state lives in its own table so a decided request is never edited. Applying it in production is a human step.

-- CreateEnum
CREATE TYPE "CancellationExecutionStatus" AS ENUM ('REQUESTED', 'PROCESSOR_PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CancellationRefundMethod" AS ENUM ('SQUARE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "CancellationStepStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "CancellationRequest" ADD COLUMN     "approvedStateFingerprint" TEXT;

-- CreateTable
CREATE TABLE "CancellationExecution" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "status" "CancellationExecutionStatus" NOT NULL DEFAULT 'REQUESTED',
    "scope" TEXT NOT NULL,
    "attendeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvedRefundCents" INTEGER NOT NULL,
    "refundMethod" "CancellationRefundMethod",
    "approvedStateFingerprint" TEXT NOT NULL,
    "executedByUserId" TEXT NOT NULL,
    "executedByNameSnapshot" TEXT NOT NULL,
    "cancelStatus" "CancellationStepStatus" NOT NULL DEFAULT 'PENDING',
    "cancelFailureCode" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastFailureCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationExecutionRefund" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "CancellationStepStatus" NOT NULL DEFAULT 'PENDING',
    "refundId" TEXT,
    "providerRefundId" TEXT,
    "failureCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolvedByNameSnapshot" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationExecutionRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CancellationExecution_requestId_key" ON "CancellationExecution"("requestId");

-- CreateIndex
CREATE INDEX "CancellationExecution_eventId_status_idx" ON "CancellationExecution"("eventId", "status");

-- CreateIndex
CREATE INDEX "CancellationExecution_registrationId_idx" ON "CancellationExecution"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationExecutionRefund_idempotencyKey_key" ON "CancellationExecutionRefund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CancellationExecutionRefund_eventId_status_idx" ON "CancellationExecutionRefund"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationExecutionRefund_executionId_paymentId_key" ON "CancellationExecutionRefund"("executionId", "paymentId");

-- AddForeignKey
ALTER TABLE "CancellationExecution" ADD CONSTRAINT "CancellationExecution_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationExecution" ADD CONSTRAINT "CancellationExecution_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CancellationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationExecutionRefund" ADD CONSTRAINT "CancellationExecutionRefund_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "CancellationExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An execution can only start from an approved request on the same event and registration, so no code path, worker or
-- script can carry out a request that was not approved by a named person.
CREATE FUNCTION "require_approved_cancellation_request"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_row RECORD;
BEGIN
  SELECT "status", "eventId", "registrationId", "decidedByUserId"
    INTO request_row
    FROM "CancellationRequest"
    WHERE "id" = NEW."requestId"
    FOR SHARE;
  IF NOT FOUND
    OR request_row."status" <> 'APPROVED'
    OR request_row."decidedByUserId" IS NULL
    OR request_row."eventId" <> NEW."eventId"
    OR request_row."registrationId" <> NEW."registrationId"
  THEN
    RAISE EXCEPTION 'A cancellation can only be carried out from an approved request on the same event and registration';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CancellationExecution_requires_approval"
BEFORE INSERT ON "CancellationExecution"
FOR EACH ROW
EXECUTE FUNCTION "require_approved_cancellation_request"();

-- Carrying out is a named staff action, never an anonymous or automatic one, and never refunds a negative amount.
ALTER TABLE "CancellationExecution" ADD CONSTRAINT "CancellationExecution_named_staff_and_amount"
  CHECK (
    length(btrim("executedByUserId")) > 0
    AND length(btrim("executedByNameSnapshot")) > 0
    AND "approvedRefundCents" >= 0
    AND ("approvedRefundCents" = 0 OR "refundMethod" IS NOT NULL)
    AND "attempts" >= 1
  );

-- What was approved and who chose the method never changes after the execution starts. Only its progress does.
CREATE FUNCTION "reject_cancellation_execution_snapshot_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."requestId" IS DISTINCT FROM OLD."requestId"
    OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
    OR NEW."registrationId" IS DISTINCT FROM OLD."registrationId"
    OR NEW."scope" IS DISTINCT FROM OLD."scope"
    OR NEW."attendeeIds" IS DISTINCT FROM OLD."attendeeIds"
    OR NEW."approvedRefundCents" IS DISTINCT FROM OLD."approvedRefundCents"
    OR NEW."refundMethod" IS DISTINCT FROM OLD."refundMethod"
    OR NEW."approvedStateFingerprint" IS DISTINCT FROM OLD."approvedStateFingerprint"
    OR NEW."executedByUserId" IS DISTINCT FROM OLD."executedByUserId"
    OR NEW."executedByNameSnapshot" IS DISTINCT FROM OLD."executedByNameSnapshot"
  THEN
    RAISE EXCEPTION 'The approved snapshot of a cancellation execution cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CancellationExecution_snapshot_fixed"
BEFORE UPDATE ON "CancellationExecution"
FOR EACH ROW
EXECUTE FUNCTION "reject_cancellation_execution_snapshot_change"();

-- A refund leg is for a positive amount, and all legs of one execution add up to at most the approved refund. The
-- execution row is locked first, so two writers cannot both pass the total.
ALTER TABLE "CancellationExecutionRefund" ADD CONSTRAINT "CancellationExecutionRefund_positive_amount"
  CHECK ("amountCents" > 0 AND "attempts" >= 0);

CREATE FUNCTION "enforce_cancellation_execution_refund_total"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approved INTEGER;
  already BIGINT;
BEGIN
  SELECT "approvedRefundCents" INTO approved
    FROM "CancellationExecution"
    WHERE "id" = NEW."executionId"
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The cancellation execution does not exist';
  END IF;
  SELECT COALESCE(SUM("amountCents"), 0) INTO already
    FROM "CancellationExecutionRefund"
    WHERE "executionId" = NEW."executionId";
  IF already + NEW."amountCents" > approved THEN
    RAISE EXCEPTION 'The refunds of a cancellation execution cannot add up to more than the approved refund';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CancellationExecutionRefund_within_approved"
BEFORE INSERT ON "CancellationExecutionRefund"
FOR EACH ROW
EXECUTE FUNCTION "enforce_cancellation_execution_refund_total"();

-- A leg's payment, amount and key are fixed at creation: a retry sends the same key for the same amount. Only its
-- progress changes, and a leg that reached DONE never goes back.
CREATE FUNCTION "reject_cancellation_execution_refund_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."executionId" IS DISTINCT FROM OLD."executionId"
    OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
    OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
    OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
  THEN
    RAISE EXCEPTION 'The payment, amount and key of a cancellation refund cannot be changed';
  END IF;
  IF OLD."status" = 'DONE' AND NEW."status" <> 'DONE' THEN
    RAISE EXCEPTION 'A completed cancellation refund cannot be reopened';
  END IF;
  IF OLD."resolvedAt" IS NOT NULL AND (
    NEW."resolvedAt" IS DISTINCT FROM OLD."resolvedAt"
    OR NEW."resolvedByUserId" IS DISTINCT FROM OLD."resolvedByUserId"
    OR NEW."resolvedByNameSnapshot" IS DISTINCT FROM OLD."resolvedByNameSnapshot"
    OR NEW."resolutionNote" IS DISTINCT FROM OLD."resolutionNote"
    OR NEW."status" <> 'FAILED'
  ) THEN
    RAISE EXCEPTION 'A resolved cancellation refund cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CancellationExecutionRefund_fixed_once_created"
BEFORE UPDATE ON "CancellationExecutionRefund"
FOR EACH ROW
EXECUTE FUNCTION "reject_cancellation_execution_refund_change"();

-- A failed refund can be settled outside this tool only by a named person with a note, and never a completed one. Settling it
-- moves no money: it records who decided the failed refund needs nothing more from here.
ALTER TABLE "CancellationExecutionRefund" ADD CONSTRAINT "CancellationExecutionRefund_resolution_is_named"
  CHECK (
    "resolvedAt" IS NULL
    OR (
      "status" = 'FAILED'
      AND length(btrim(coalesce("resolvedByUserId", ''))) > 0
      AND length(btrim(coalesce("resolvedByNameSnapshot", ''))) > 0
      AND length(btrim(coalesce("resolutionNote", ''))) > 0
    )
  );
