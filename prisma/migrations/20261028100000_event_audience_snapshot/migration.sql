-- Reviewed event audience snapshots (#176). Additive: one new table. A row records the normalized query, its version,
-- the audience fingerprint and the counts only; it never holds a recipient, an address or a note.

-- CreateTable
CREATE TABLE "EventAudienceSnapshot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "sourceQueryVersion" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "exclusionCount" INTEGER NOT NULL,
    "registrationCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAudienceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventAudienceSnapshot_eventId_createdAt_idx" ON "EventAudienceSnapshot"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "EventAudienceSnapshot_eventId_fingerprint_idx" ON "EventAudienceSnapshot"("eventId", "fingerprint");

-- AddForeignKey
ALTER TABLE "EventAudienceSnapshot" ADD CONSTRAINT "EventAudienceSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAudienceSnapshot" ADD CONSTRAINT "EventAudienceSnapshot_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
