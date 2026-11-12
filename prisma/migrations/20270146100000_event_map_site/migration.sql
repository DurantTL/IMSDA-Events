-- Event map site (#1212). Additive: one nullable column, its index and its foreign key; safe to re-run.
-- Applying it in production is a human step.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "mapSiteOrganizationId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Event_mapSiteOrganizationId_idx" ON "Event"("mapSiteOrganizationId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Event" ADD CONSTRAINT "Event_mapSiteOrganizationId_fkey" FOREIGN KEY ("mapSiteOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
