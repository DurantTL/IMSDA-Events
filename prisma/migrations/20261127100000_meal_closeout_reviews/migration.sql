-- Meal closeout exception reviews (#212). Additive only: one enum and one table with a shape check and an append-only trigger.
-- No existing row is read, moved or changed.

-- CreateEnum
CREATE TYPE "MealCloseoutReviewStatus" AS ENUM ('ACKNOWLEDGED', 'REOPENED');

-- CreateTable
CREATE TABLE "EventMealCloseoutReview" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "exceptionKey" TEXT NOT NULL,
    "status" "MealCloseoutReviewStatus" NOT NULL,
    "detailDigest" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMealCloseoutReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventMealCloseoutReview_eventId_exceptionKey_createdAt_idx" ON "EventMealCloseoutReview"("eventId", "exceptionKey", "createdAt");

-- AddForeignKey
ALTER TABLE "EventMealCloseoutReview" ADD CONSTRAINT "EventMealCloseoutReview_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints and triggers Prisma cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE "EventMealCloseoutReview" ADD CONSTRAINT "EventMealCloseoutReview_shape" CHECK (
  length("exceptionKey") > 0 AND length("exceptionKey") <= 200
  AND length("note") > 0 AND length("note") <= 1000
  AND length("detailDigest") > 0 AND length("detailDigest") <= 128
);

-- Append-only, with the same function as the other meal history tables: deleted only with their event.
CREATE TRIGGER "EventMealCloseoutReview_append_only" BEFORE UPDATE OR DELETE ON "EventMealCloseoutReview" FOR EACH ROW EXECUTE FUNCTION "EventMealHistory_append_only"();
