-- Cancellation policy slice 1 (#169): versioned per-event rules and recorded calculations.
-- Additive only: two new tables. Nothing existing changes, and nothing here moves money or changes a registration.
--
-- Both tables are append-only. A BEFORE UPDATE OR DELETE trigger rejects every change; the single relaxation is a
-- DELETE inside a transaction that set `imsda.event_deletion` to 'on', which only the event deletion service does
-- (the same rule as RegistrationOperation, see 20260929196400). A policy version is never edited, so a later revision
-- cannot alter what an earlier calculation says it used.

-- CreateTable
CREATE TABLE "EventCancellationPolicyVersion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "rulesSchema" INTEGER NOT NULL DEFAULT 1,
    "rules" JSONB NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdByNameSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventCancellationPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationCalculation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT,
    "policyVersionId" TEXT,
    "policyVersion" INTEGER,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "facts" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancellationCalculation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventCancellationPolicyVersion_eventId_effectiveFrom_idx" ON "EventCancellationPolicyVersion"("eventId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "EventCancellationPolicyVersion_eventId_version_key" ON "EventCancellationPolicyVersion"("eventId", "version");

-- CreateIndex
CREATE INDEX "CancellationCalculation_eventId_createdAt_idx" ON "CancellationCalculation"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "CancellationCalculation_registrationId_createdAt_idx" ON "CancellationCalculation"("registrationId", "createdAt");

-- CreateIndex
CREATE INDEX "CancellationCalculation_policyVersionId_idx" ON "CancellationCalculation"("policyVersionId");

-- AddForeignKey
ALTER TABLE "EventCancellationPolicyVersion" ADD CONSTRAINT "EventCancellationPolicyVersion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationCalculation" ADD CONSTRAINT "CancellationCalculation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationCalculation" ADD CONSTRAINT "CancellationCalculation_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "EventCancellationPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE FUNCTION "reject_cancellation_policy_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('imsda.event_deletion', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "EventCancellationPolicyVersion_immutable"
BEFORE UPDATE OR DELETE ON "EventCancellationPolicyVersion"
FOR EACH ROW
EXECUTE FUNCTION "reject_cancellation_policy_mutation"();

CREATE TRIGGER "CancellationCalculation_immutable"
BEFORE UPDATE OR DELETE ON "CancellationCalculation"
FOR EACH ROW
EXECUTE FUNCTION "reject_cancellation_policy_mutation"();
