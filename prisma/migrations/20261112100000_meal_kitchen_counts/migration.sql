-- Kitchen-entered meal counts (#1029). Additive only: two enum values, one enum, one table with constraints and triggers.
-- No existing row is read, moved or changed.

-- AlterEnum
ALTER TYPE "EventRole" ADD VALUE 'KITCHEN_STAFF';

-- AlterEnum
ALTER TYPE "EventPermission" ADD VALUE 'MANAGE_KITCHEN_COUNTS';

-- CreateEnum
CREATE TYPE "MealKitchenCountKind" AS ENUM ('PREPARED', 'WASTED', 'DONATED', 'TRANSFERRED');

-- CreateTable
CREATE TABLE "EventMealKitchenCount" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "serviceDate" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "kind" "MealKitchenCountKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "enteredByUserId" TEXT NOT NULL,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMealKitchenCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventMealKitchenCount_supersedesId_key" ON "EventMealKitchenCount"("supersedesId");

-- CreateIndex
CREATE INDEX "EventMealKitchenCount_eventId_serviceDate_mealType_kind_cre_idx" ON "EventMealKitchenCount"("eventId", "serviceDate", "mealType", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "EventMealKitchenCount" ADD CONSTRAINT "EventMealKitchenCount_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealKitchenCount" ADD CONSTRAINT "EventMealKitchenCount_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "EventMealKitchenCount"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Constraints and triggers Prisma cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE "EventMealKitchenCount" ADD CONSTRAINT "EventMealKitchenCount_shape" CHECK (
  "quantity" >= 0 AND "quantity" <= 100000
  AND ("serviceDate" = '' OR "serviceDate" ~ '^\d{4}-\d{2}-\d{2}$')
  AND ("note" IS NULL OR (length("note") > 0 AND length("note") <= 500))
);

-- One chain per (event, service, kind): only one row may start it, and (by the unique supersedesId) only one row may
-- follow any row, so a chain never forks.
CREATE UNIQUE INDEX "EventMealKitchenCount_chain_root" ON "EventMealKitchenCount"("eventId", "serviceDate", "mealType", "kind") WHERE "supersedesId" IS NULL;

-- A correction replaces a row of the same event, service and kind.
CREATE FUNCTION "EventMealKitchenCount_supersedes_same_chain"() RETURNS trigger AS $$
BEGIN
  IF NEW."supersedesId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "EventMealKitchenCount" WHERE "id" = NEW."supersedesId" AND "eventId" = NEW."eventId"
      AND "serviceDate" = NEW."serviceDate" AND "mealType" = NEW."mealType" AND "kind" = NEW."kind"
  ) THEN
    RAISE EXCEPTION 'A kitchen count correction must replace an earlier count of the same event, service and kind.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "EventMealKitchenCount_supersedes_same_chain" BEFORE INSERT ON "EventMealKitchenCount" FOR EACH ROW EXECUTE FUNCTION "EventMealKitchenCount_supersedes_same_chain"();

-- Append-only, with the same function as the other meal history tables: deleted only with their event.
CREATE TRIGGER "EventMealKitchenCount_append_only" BEFORE UPDATE OR DELETE ON "EventMealKitchenCount" FOR EACH ROW EXECUTE FUNCTION "EventMealHistory_append_only"();
