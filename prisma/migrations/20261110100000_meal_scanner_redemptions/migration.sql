-- Café scanner results (#1028). Additive only: two new tables, two enums, constraints and triggers on those tables.
-- No existing row is read, moved or changed.

-- CreateEnum
CREATE TYPE "MealScannerSource" AS ENUM ('SHEET', 'TRANSACTIONS');

-- CreateEnum
CREATE TYPE "MealRedemptionKind" AS ENUM ('REDEEMED', 'UNREDEEMED');

-- CreateTable
CREATE TABLE "EventMealImportBatch" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "source" "MealScannerSource" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "redeemedCount" INTEGER NOT NULL,
    "unredeemedCount" INTEGER NOT NULL,
    "reviewCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMealImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMealRedemption" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" "MealRedemptionKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "redeemedByText" TEXT,
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMealRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventMealImportBatch_eventId_createdAt_idx" ON "EventMealImportBatch"("eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventMealRedemption_eventId_sourceKey_key" ON "EventMealRedemption"("eventId", "sourceKey");

-- CreateIndex
CREATE INDEX "EventMealRedemption_ticketId_createdAt_idx" ON "EventMealRedemption"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "EventMealRedemption_batchId_idx" ON "EventMealRedemption"("batchId");

-- AddForeignKey
ALTER TABLE "EventMealImportBatch" ADD CONSTRAINT "EventMealImportBatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealRedemption" ADD CONSTRAINT "EventMealRedemption_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealRedemption" ADD CONSTRAINT "EventMealRedemption_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "EventMealTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealRedemption" ADD CONSTRAINT "EventMealRedemption_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EventMealImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints and triggers Prisma cannot express. Both tables are append-only (same rule and the same function as the
-- other meal history tables: deleted only with their event), and a redemption's ticket and batch must be the event's own.
-- ---------------------------------------------------------------------------

ALTER TABLE "EventMealImportBatch" ADD CONSTRAINT "EventMealImportBatch_shape" CHECK (
  "rowCount" >= 0 AND "redeemedCount" >= 0 AND "unredeemedCount" >= 0 AND "reviewCount" >= 0
  AND "fileSha256" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "EventMealRedemption" ADD CONSTRAINT "EventMealRedemption_shape" CHECK (length(btrim("sourceKey")) > 0);

CREATE FUNCTION "EventMealRedemption_same_event"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EventMealTicket" WHERE "id" = NEW."ticketId" AND "eventId" = NEW."eventId") THEN
    RAISE EXCEPTION 'A redemption must be for a ticket of its own event.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "EventMealImportBatch" WHERE "id" = NEW."batchId" AND "eventId" = NEW."eventId") THEN
    RAISE EXCEPTION 'A redemption must belong to an import batch of its own event.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "EventMealRedemption_same_event" BEFORE INSERT ON "EventMealRedemption" FOR EACH ROW EXECUTE FUNCTION "EventMealRedemption_same_event"();

CREATE TRIGGER "EventMealImportBatch_append_only" BEFORE UPDATE OR DELETE ON "EventMealImportBatch" FOR EACH ROW EXECUTE FUNCTION "EventMealHistory_append_only"();
CREATE TRIGGER "EventMealRedemption_append_only" BEFORE UPDATE OR DELETE ON "EventMealRedemption" FOR EACH ROW EXECUTE FUNCTION "EventMealHistory_append_only"();
