-- Bulk messages wait for approval (#182). Two bulk action keys and a table for the messages a confirmed bulk run queued. A
-- confirmed run never sends: it creates one row here, and a person with communications access approves it later. The row holds
-- the template key, the staff-written title and body, the queued registration ids and counts; no address and no name.
-- Additive only: two enum values, one enum, one table. No existing row is read, moved or changed.

-- AlterEnum
ALTER TYPE "BulkActionKey" ADD VALUE 'QUEUE_MESSAGE';
ALTER TYPE "BulkActionKey" ADD VALUE 'REQUEST_INFORMATION';

-- CreateEnum
CREATE TYPE "BulkMessageApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'SENDING', 'SENT', 'DECLINED');

-- CreateTable
CREATE TABLE "BulkMessageApproval" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "action" "BulkActionKey" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "announcementTitle" TEXT,
    "announcementBody" TEXT,
    "registrationIds" JSONB NOT NULL,
    "queuedCount" INTEGER NOT NULL,
    "status" "BulkMessageApprovalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "queuedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "sendResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkMessageApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BulkMessageApproval_runId_key" ON "BulkMessageApproval"("runId");

-- CreateIndex
CREATE INDEX "BulkMessageApproval_eventId_status_idx" ON "BulkMessageApproval"("eventId", "status");

-- AddForeignKey
ALTER TABLE "BulkMessageApproval" ADD CONSTRAINT "BulkMessageApproval_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkMessageApproval" ADD CONSTRAINT "BulkMessageApproval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BulkActionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkMessageApproval" ADD CONSTRAINT "BulkMessageApproval_queuedByUserId_fkey" FOREIGN KEY ("queuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkMessageApproval" ADD CONSTRAINT "BulkMessageApproval_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
