-- Break-glass for the live health record (#929, ADR 0005 Addendum B). The grant table from #924
-- ("HealthSnapshotBreakGlass") is unchanged: one grant per person now covers that person's live record and
-- their sealed copies. This migration is additive: one enum and one table that records each USE of a grant for
-- the monthly review. Ids, a kind and a time only: never a health value. The grant, user and person ids are
-- nullable with ON DELETE SET NULL, so deleting a person or a grant keeps the review trail.

-- CreateEnum
CREATE TYPE "HealthBreakGlassUseKind" AS ENUM ('LIVE_RECORD', 'SEALED_COPIES');

-- CreateTable
CREATE TABLE "HealthBreakGlassUse" (
    "id" TEXT NOT NULL,
    "grantId" TEXT,
    "userId" TEXT,
    "personId" TEXT,
    "kind" "HealthBreakGlassUseKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthBreakGlassUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthBreakGlassUse_grantId_createdAt_idx" ON "HealthBreakGlassUse"("grantId", "createdAt");

-- CreateIndex
CREATE INDEX "HealthBreakGlassUse_createdAt_idx" ON "HealthBreakGlassUse"("createdAt");

-- AddForeignKey
ALTER TABLE "HealthBreakGlassUse" ADD CONSTRAINT "HealthBreakGlassUse_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "HealthSnapshotBreakGlass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthBreakGlassUse" ADD CONSTRAINT "HealthBreakGlassUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthBreakGlassUse" ADD CONSTRAINT "HealthBreakGlassUse_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The grant outlives the person it was for: deleting a Person keeps the grant (and so the uses recorded against it)
-- for the monthly review, with the person id cleared, instead of erasing the trail.
ALTER TABLE "HealthSnapshotBreakGlass" DROP CONSTRAINT "HealthSnapshotBreakGlass_personId_fkey";
ALTER TABLE "HealthSnapshotBreakGlass" ALTER COLUMN "personId" DROP NOT NULL;
ALTER TABLE "HealthSnapshotBreakGlass" ADD CONSTRAINT "HealthSnapshotBreakGlass_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
