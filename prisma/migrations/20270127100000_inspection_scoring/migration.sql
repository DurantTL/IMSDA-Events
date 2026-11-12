-- Campsite and uniform inspection scoring (#1896). Additive: one nullable column on ScoredActivity that marks the two
-- inspection events the optional Inspections tool makes, and a unique index so each exists once per event (rows with no
-- inspection kind are never compared). Drops nothing, renames nothing, and moves no data.

-- AlterTable
ALTER TABLE "ScoredActivity" ADD COLUMN "inspectionKind" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ScoredActivity_eventId_inspectionKind_key" ON "ScoredActivity"("eventId", "inspectionKind");
