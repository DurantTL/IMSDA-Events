-- Honor watch (#1099): staff choose a few addresses to be told, once a day, about youth joining or leaving classes that teach
-- chosen honors. Additive only: one new message template key and one new table that holds no youth data (the staff's own choices
-- and the end of the last summary's window). Applying this in production is a human step.

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'HONOR_WATCH_SUMMARY';

-- CreateTable
CREATE TABLE "HonorWatch" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "recipients" TEXT[],
    "honorIds" TEXT[],
    "offeringIds" TEXT[],
    "summaryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HonorWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HonorWatch_eventId_position_idx" ON "HonorWatch"("eventId", "position");

-- AddForeignKey
ALTER TABLE "HonorWatch" ADD CONSTRAINT "HonorWatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
