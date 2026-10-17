-- Scheduled email batches (#177). Additive: three enums and two new tables, no existing row is touched.
-- A batch is written and reviewed first (SCHEDULED) and only a person moves it to ACTIVE; nothing in this migration
-- activates or sends anything. A recipient row is one reviewed (registration, address) pair; the unique key on
-- (batchId, registrationId, recipientEmail) and the outbox's own idempotency key keep a retry or a second worker from
-- queueing anyone twice.

-- CreateEnum
CREATE TYPE "ScheduledEmailTrigger" AS ENUM ('ONE_TIME', 'BEFORE_REGISTRATION_CLOSE', 'BEFORE_EVENT_START');

-- CreateEnum
CREATE TYPE "ScheduledEmailBatchStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScheduledEmailRecipientStatus" AS ENUM ('PLANNED', 'QUEUED', 'EXCLUDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ScheduledEmailBatch" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateKey" "MessageTemplateKey" NOT NULL,
    "announcementTitle" TEXT,
    "announcementBody" TEXT,
    "templateVersionId" TEXT,
    "templateVersionNumber" INTEGER,
    "trigger" "ScheduledEmailTrigger" NOT NULL,
    "localDate" TEXT,
    "localTime" TEXT NOT NULL,
    "daysBefore" INTEGER,
    "eventTimezone" TEXT NOT NULL,
    "anchorAt" TIMESTAMP(3),
    "sendAt" TIMESTAMP(3) NOT NULL,
    "dstBehavior" TEXT NOT NULL DEFAULT 'NONE',
    "dstNote" TEXT,
    "audienceQuery" JSONB NOT NULL,
    "audienceQueryVersion" TEXT NOT NULL,
    "audienceQueryHash" TEXT NOT NULL,
    "audienceFingerprint" TEXT NOT NULL,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "ScheduledEmailBatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdByUserId" TEXT NOT NULL,
    "activatedByUserId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledEmailBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledEmailRecipient" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "roles" TEXT[],
    "status" "ScheduledEmailRecipientStatus" NOT NULL DEFAULT 'PLANNED',
    "exclusionCode" TEXT,
    "outboxMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledEmailRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledEmailBatch_eventId_createdAt_idx" ON "ScheduledEmailBatch"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledEmailBatch_status_sendAt_idx" ON "ScheduledEmailBatch"("status", "sendAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledEmailRecipient_outboxMessageId_key" ON "ScheduledEmailRecipient"("outboxMessageId");

-- CreateIndex
CREATE INDEX "ScheduledEmailRecipient_batchId_status_idx" ON "ScheduledEmailRecipient"("batchId", "status");

-- CreateIndex
CREATE INDEX "ScheduledEmailRecipient_eventId_idx" ON "ScheduledEmailRecipient"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledEmailRecipient_batchId_registrationId_recipientEma_key" ON "ScheduledEmailRecipient"("batchId", "registrationId", "recipientEmail");

-- AddForeignKey
ALTER TABLE "ScheduledEmailBatch" ADD CONSTRAINT "ScheduledEmailBatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledEmailBatch" ADD CONSTRAINT "ScheduledEmailBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledEmailBatch" ADD CONSTRAINT "ScheduledEmailBatch_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledEmailRecipient" ADD CONSTRAINT "ScheduledEmailRecipient_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ScheduledEmailBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledEmailRecipient" ADD CONSTRAINT "ScheduledEmailRecipient_outboxMessageId_fkey" FOREIGN KEY ("outboxMessageId") REFERENCES "MessageOutbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A schedule that is approved must say who approved it and when.
ALTER TABLE "ScheduledEmailBatch" ADD CONSTRAINT "ScheduledEmailBatch_activation_check"
  CHECK ("status" NOT IN ('ACTIVE', 'COMPLETED') OR ("activatedByUserId" IS NOT NULL AND "activatedAt" IS NOT NULL));
ALTER TABLE "ScheduledEmailBatch" ADD CONSTRAINT "ScheduledEmailBatch_localTime_check"
  CHECK ("localTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "ScheduledEmailBatch" ADD CONSTRAINT "ScheduledEmailBatch_rule_check"
  CHECK (
    ("trigger" = 'ONE_TIME' AND "localDate" IS NOT NULL AND "daysBefore" IS NULL)
    OR ("trigger" <> 'ONE_TIME' AND "localDate" IS NULL AND "daysBefore" IS NOT NULL AND "daysBefore" BETWEEN 0 AND 365)
  );
