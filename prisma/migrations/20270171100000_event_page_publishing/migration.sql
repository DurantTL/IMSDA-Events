-- Event page publishing (#1514): scheduled publish, a private preview link and published versions. ADDITIVE ONLY: one
-- nullable column, one enum and two new tables with their indexes and foreign keys. Applying it in production is a human
-- step (back up first).

-- CreateEnum
CREATE TYPE "EventPageVersionSource" AS ENUM ('SAVE', 'SCHEDULED_PUBLISH', 'ROLLBACK');

-- AlterTable
ALTER TABLE "EventContentSection" ADD COLUMN "scheduledPublishAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EventPagePreviewLink" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "EventPagePreviewLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPageVersion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "source" "EventPageVersionSource" NOT NULL,
    "restoredFromId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventPageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventContentSection_isPublished_scheduledPublishAt_idx" ON "EventContentSection"("isPublished", "scheduledPublishAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventPagePreviewLink_tokenHash_key" ON "EventPagePreviewLink"("tokenHash");

-- CreateIndex
CREATE INDEX "EventPagePreviewLink_eventId_createdAt_idx" ON "EventPagePreviewLink"("eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventPageVersion_eventId_versionNumber_key" ON "EventPageVersion"("eventId", "versionNumber");

-- AddForeignKey
ALTER TABLE "EventPagePreviewLink" ADD CONSTRAINT "EventPagePreviewLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPagePreviewLink" ADD CONSTRAINT "EventPagePreviewLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPagePreviewLink" ADD CONSTRAINT "EventPagePreviewLink_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPageVersion" ADD CONSTRAINT "EventPageVersion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPageVersion" ADD CONSTRAINT "EventPageVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
