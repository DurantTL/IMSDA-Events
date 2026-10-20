-- Honors Weekend instructors hear when a youth joins or leaves one of their classes (#1098). Additive only: two new message template keys, two enums, two
-- columns on "HonorInstructor" (existing instructors default to the daily summary) and one new change-log table.
-- Applying this in production is a human step.

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'HONOR_INSTRUCTOR_CLASS_SUMMARY';
ALTER TYPE "MessageTemplateKey" ADD VALUE 'HONOR_INSTRUCTOR_CLASS_CHANGE';

-- CreateEnum
CREATE TYPE "HonorClassChangeEmails" AS ENUM ('DAILY', 'IMMEDIATE', 'OFF');

-- CreateEnum
CREATE TYPE "HonorClassChangeKind" AS ENUM ('JOINED', 'LEFT');

-- AlterTable
ALTER TABLE "HonorInstructor" ADD COLUMN     "classChangeEmails" "HonorClassChangeEmails" NOT NULL DEFAULT 'DAILY',
ADD COLUMN     "classChangeSummaryAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HonorClassChange" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "registrationAttendeeId" TEXT NOT NULL,
    "kind" "HonorClassChangeKind" NOT NULL,
    "youthName" TEXT NOT NULL,
    "clubName" TEXT,
    "ageOnEventDate" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "immediateHandledAt" TIMESTAMP(3),

    CONSTRAINT "HonorClassChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HonorClassChange_offeringId_at_idx" ON "HonorClassChange"("offeringId", "at");

-- CreateIndex
CREATE INDEX "HonorClassChange_immediateHandledAt_at_idx" ON "HonorClassChange"("immediateHandledAt", "at");

-- CreateIndex
CREATE INDEX "HonorClassChange_eventId_idx" ON "HonorClassChange"("eventId");

-- AddForeignKey
ALTER TABLE "HonorClassChange" ADD CONSTRAINT "HonorClassChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HonorClassChange" ADD CONSTRAINT "HonorClassChange_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "HonorOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
