-- Optional post-event debrief (#1679). Additive: new enum values, one nullable form column, one settings table, and one
-- relaxed rule on scheduled email batches: a debrief batch switched on by an Area Coordinator has no staff user, so it names
-- the approving account instead (the approval check is replaced by one that allows exactly that and nothing wider). Drops no
-- column or table, renames nothing, and moves no data.

-- CreateEnum
CREATE TYPE "InformationFormPurpose" AS ENUM ('DEBRIEF', 'DIRECTOR_EVALUATION');

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'EVENT_DEBRIEF_INVITE';
ALTER TYPE "MessageTemplateKey" ADD VALUE 'EVENT_DEBRIEF_REMINDER';

-- AlterEnum
ALTER TYPE "ScheduledEmailTrigger" ADD VALUE 'AFTER_EVENT_END';

-- AlterTable
ALTER TABLE "ScheduledEmailBatch" ADD COLUMN     "createdByAttendeeAccountId" TEXT,
ADD COLUMN     "activatedByAttendeeAccountId" TEXT,
ALTER COLUMN "createdByUserId" DROP NOT NULL;

-- An approved batch must still say who approved it and when. Only a debrief batch may name an attendee account (an Area
-- Coordinator) instead of a staff user. The trigger is compared as text because a new enum value cannot be used in the migration that adds it.
ALTER TABLE "ScheduledEmailBatch" DROP CONSTRAINT "ScheduledEmailBatch_activation_check";
ALTER TABLE "ScheduledEmailBatch" ADD CONSTRAINT "ScheduledEmailBatch_activation_check"
  CHECK (
    "status" NOT IN ('ACTIVE', 'COMPLETED')
    OR (
      "activatedAt" IS NOT NULL
      AND ("activatedByUserId" IS NOT NULL OR ("trigger"::text = 'AFTER_EVENT_END' AND "activatedByAttendeeAccountId" IS NOT NULL))
    )
  );

-- AlterTable
ALTER TABLE "InformationForm" ADD COLUMN     "purpose" "InformationFormPurpose";

-- CreateTable
CREATE TABLE "EventDebrief" (
    "eventId" TEXT NOT NULL,
    "evaluationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "carriedFromEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDebrief_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "EventDebrief_carriedFromEventId_idx" ON "EventDebrief"("carriedFromEventId");

-- CreateIndex
CREATE UNIQUE INDEX "InformationForm_eventId_purpose_key" ON "InformationForm"("eventId", "purpose");

-- AddForeignKey
ALTER TABLE "EventDebrief" ADD CONSTRAINT "EventDebrief_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDebrief" ADD CONSTRAINT "EventDebrief_carriedFromEventId_fkey" FOREIGN KEY ("carriedFromEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
