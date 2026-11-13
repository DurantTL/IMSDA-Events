-- Profile photos for staff accounts (#1640). Additive: one new table; safe to re-run.
-- Applying it in production is a human step.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProfilePhoto" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT,
    "thumbStorageKey" TEXT,
    "byteSize" INTEGER,
    "checksum" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "removedByStaffAt" TIMESTAMP(3),
    "removedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfilePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePhoto_userId_key" ON "ProfilePhoto"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePhoto_storageKey_key" ON "ProfilePhoto"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePhoto_thumbStorageKey_key" ON "ProfilePhoto"("thumbStorageKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProfilePhoto_removedByUserId_idx" ON "ProfilePhoto"("removedByUserId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_removedByUserId_fkey" FOREIGN KEY ("removedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
