-- Cancellation policy slice 2 (#170): a registrant's request, its status timeline, and two email template keys.
-- Additive only: one enum, two tables, two enum values. Nothing existing changes. A request is only a request: no row
-- here cancels a registration, refunds money or issues credit (that is #171, and a human). Applying it in production is
-- a human step.

-- CreateEnum
CREATE TYPE "CancellationRequestStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'INFORMATION_NEEDED', 'APPROVED', 'DECLINED', 'WITHDRAWN', 'SUPERSEDED');

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'CANCELLATION_REQUEST_RECEIVED';
ALTER TYPE "MessageTemplateKey" ADD VALUE 'CANCELLATION_REQUEST_UPDATED';

-- CreateTable
CREATE TABLE "CancellationRequest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "policyVersionId" TEXT,
    "policyVersion" INTEGER,
    "scope" TEXT NOT NULL,
    "attendeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chargeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopeKey" TEXT NOT NULL,
    "status" "CancellationRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "contactMethod" TEXT NOT NULL,
    "proposedRefundCents" INTEGER NOT NULL,
    "proposedRetainedCents" INTEGER NOT NULL,
    "stateFingerprint" TEXT NOT NULL,
    "registrationState" JSONB NOT NULL,
    "requestedVia" TEXT NOT NULL,
    "requestedByAccountId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "supersededById" TEXT,
    "registrantNote" TEXT,
    "decidedByUserId" TEXT,
    "decidedByNameSnapshot" TEXT,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedWithChanges" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationRequestEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" "CancellationRequestStatus",
    "toStatus" "CancellationRequestStatus" NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorNameSnapshot" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancellationRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CancellationRequest_eventId_status_createdAt_idx" ON "CancellationRequest"("eventId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CancellationRequest_registrationId_status_idx" ON "CancellationRequest"("registrationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationRequest_registrationId_idempotencyKey_key" ON "CancellationRequest"("registrationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CancellationRequestEvent_requestId_createdAt_idx" ON "CancellationRequestEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "CancellationRequestEvent_eventId_createdAt_idx" ON "CancellationRequestEvent"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "CancellationCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationRequestEvent" ADD CONSTRAINT "CancellationRequestEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationRequestEvent" ADD CONSTRAINT "CancellationRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CancellationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A request is open until it is decided, withdrawn or superseded. The database refuses a second open request for the
-- same registration and scope, so two taps or two tabs leave one (Prisma cannot express a partial index).
CREATE UNIQUE INDEX "CancellationRequest_one_open_per_scope" ON "CancellationRequest"("registrationId", "scopeKey")
  WHERE "status" IN ('REQUESTED', 'UNDER_REVIEW', 'INFORMATION_NEEDED');

-- Approving or declining needs a named person, a time and a reason, or the row cannot be saved. No worker, script or
-- later code path can record a decision without them.
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_decision_has_actor_and_reason"
  CHECK (
    "status" NOT IN ('APPROVED', 'DECLINED')
    OR (
      "decidedByUserId" IS NOT NULL
      AND "decidedAt" IS NOT NULL
      AND length(btrim(coalesce("decisionReason", ''))) > 0
      AND length(btrim(coalesce("decidedByNameSnapshot", ''))) > 0
    )
  );

-- The timeline is append-only, like a recorded calculation. Reuses the function from the slice 1 migration, which
-- allows only an event deletion to remove rows.
CREATE TRIGGER "CancellationRequestEvent_immutable"
BEFORE UPDATE OR DELETE ON "CancellationRequestEvent"
FOR EACH ROW
EXECUTE FUNCTION "reject_cancellation_policy_mutation"();
