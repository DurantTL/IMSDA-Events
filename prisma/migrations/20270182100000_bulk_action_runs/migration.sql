-- Reviewed bulk actions (#182): a run, its snapshot of candidate versions and per-record outcomes. Ids, keys, versions and counts only; no registrant data and no exported file. The query string can hold the search text staff typed while a run is previewed; it is replaced once the run is confirmed or expires.
-- Additive: four enums, two tables. Applying it in production is a human step.

-- CreateEnum
CREATE TYPE "BulkActionKey" AS ENUM ('APPLY_TAG', 'REMOVE_TAG', 'EXPORT_FIELDS');

-- CreateEnum
CREATE TYPE "BulkActionScopeKind" AS ENUM ('FILTER', 'SELECTED');

-- CreateEnum
CREATE TYPE "BulkActionRunStatus" AS ENUM ('PREVIEWED', 'APPLYING', 'APPLIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BulkActionOutcome" AS ENUM ('COMPLETED', 'SKIPPED', 'CONFLICT', 'FAILED', 'OBSOLETE');

-- CreateTable
CREATE TABLE "BulkActionRun" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "BulkActionKey" NOT NULL,
    "params" JSONB NOT NULL,
    "scopeKind" "BulkActionScopeKind" NOT NULL,
    "queryString" TEXT NOT NULL,
    "selectedIds" JSONB,
    "recordUnit" TEXT NOT NULL DEFAULT 'registrations',
    "candidateCount" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "BulkActionRunStatus" NOT NULL DEFAULT 'PREVIEWED',
    "idempotencyKey" TEXT,
    "previewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "obsoleteCount" INTEGER NOT NULL DEFAULT 0,
    "exportRowCount" INTEGER,

    CONSTRAINT "BulkActionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkActionRecordOutcome" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "outcome" "BulkActionOutcome" NOT NULL,
    "reason" TEXT,

    CONSTRAINT "BulkActionRecordOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkActionRun_eventId_previewedAt_idx" ON "BulkActionRun"("eventId", "previewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BulkActionRun_eventId_idempotencyKey_key" ON "BulkActionRun"("eventId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BulkActionRecordOutcome_registrationId_idx" ON "BulkActionRecordOutcome"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkActionRecordOutcome_runId_registrationId_key" ON "BulkActionRecordOutcome"("runId", "registrationId");

-- AddForeignKey
ALTER TABLE "BulkActionRun" ADD CONSTRAINT "BulkActionRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkActionRun" ADD CONSTRAINT "BulkActionRun_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkActionRecordOutcome" ADD CONSTRAINT "BulkActionRecordOutcome_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BulkActionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkActionRecordOutcome" ADD CONSTRAINT "BulkActionRecordOutcome_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

