-- Shared event header image library (#1913). Additive: one new table and one nullable column; nothing altered or dropped.
-- Applying it in production is a human step.

-- CreateTable
CREATE TABLE "EventImageLibraryImage" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "altText" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceEventId" TEXT,
    "sourceEventTitle" TEXT NOT NULL DEFAULT '',
    "sourceEventStartsAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "retiredByUserId" TEXT,

    CONSTRAINT "EventImageLibraryImage_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "EventAsset" ADD COLUMN "libraryImageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EventImageLibraryImage_checksum_key" ON "EventImageLibraryImage"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "EventImageLibraryImage_storageKey_key" ON "EventImageLibraryImage"("storageKey");

-- CreateIndex
CREATE INDEX "EventImageLibraryImage_createdAt_idx" ON "EventImageLibraryImage"("createdAt");

-- CreateIndex
CREATE INDEX "EventImageLibraryImage_sourceEventId_idx" ON "EventImageLibraryImage"("sourceEventId");

-- CreateIndex
CREATE INDEX "EventAsset_libraryImageId_idx" ON "EventAsset"("libraryImageId");

-- AddForeignKey
ALTER TABLE "EventImageLibraryImage" ADD CONSTRAINT "EventImageLibraryImage_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImageLibraryImage" ADD CONSTRAINT "EventImageLibraryImage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImageLibraryImage" ADD CONSTRAINT "EventImageLibraryImage_retiredByUserId_fkey" FOREIGN KEY ("retiredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAsset" ADD CONSTRAINT "EventAsset_libraryImageId_fkey" FOREIGN KEY ("libraryImageId") REFERENCES "EventImageLibraryImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
