-- Featured events (#1218). Additive: three columns on "Event", no data changes. Existing events are not featured.
-- Applying it in production is a human step.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "featuredOrder" INTEGER,
ADD COLUMN "featureUntil" TEXT;
