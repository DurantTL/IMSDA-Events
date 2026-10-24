-- Seeded event content (#919): the Camp Meeting meal preset and cancellation rule
-- preset move from source to versioned seeded data.
-- Additive: one new table. Nothing existing is read, changed or backfilled; the
-- rows are written by `npm run event-content:sync`, and no existing event, meal
-- service or plan, cancellation policy version, lodging or message is touched.

CREATE TABLE "SeededEventContent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeededEventContent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeededEventContent_kind_key_key" ON "SeededEventContent"("kind", "key");
