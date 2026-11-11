-- Sterling Volunteers reminders (#1844). Additive: one outbox template key and a log of who was reminded and when.

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'STERLING_REMINDER';

-- CreateTable
CREATE TABLE "BackgroundCheckReminder" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clubYear" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "sentByUserId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "directorRecipients" INTEGER NOT NULL,
    "volunteerEmailed" BOOLEAN NOT NULL,
    "batchId" TEXT NOT NULL,

    CONSTRAINT "BackgroundCheckReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackgroundCheckReminder_personId_organizationId_sentAt_idx" ON "BackgroundCheckReminder"("personId", "organizationId", "sentAt");

-- CreateIndex
CREATE INDEX "BackgroundCheckReminder_batchId_idx" ON "BackgroundCheckReminder"("batchId");
