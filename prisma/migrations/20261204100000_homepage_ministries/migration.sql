-- Public homepage "Find your place" tiles and help contact (#1251). Additive: two nullable columns on "PlatformSettings"
-- and a new table with the six starting rows. Descriptions start blank; staff fill them in under Platform settings.
-- Applying it in production is a human step.

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN "publicHelpPhone" TEXT,
ADD COLUMN "publicHelpEmail" TEXT;

-- CreateTable
CREATE TABLE "HomepageMinistry" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "linkHref" TEXT,
    "categories" TEXT[],
    "icon" TEXT NOT NULL DEFAULT 'Users',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "HomepageMinistry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomepageMinistry_position_key" ON "HomepageMinistry"("position");

-- AddForeignKey
ALTER TABLE "HomepageMinistry" ADD CONSTRAINT "HomepageMinistry_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The six starting tiles.
INSERT INTO "HomepageMinistry" ("id", "position", "name", "categories", "icon", "updatedAt") VALUES
  ('homepage-ministry-1', 1, 'Pathfinders', ARRAY['Pathfinders'], 'Compass', CURRENT_TIMESTAMP),
  ('homepage-ministry-2', 2, 'Adventurers', ARRAY['Adventurers'], 'Backpack', CURRENT_TIMESTAMP),
  ('homepage-ministry-3', 3, 'Women''s Ministries', ARRAY['Women''s Ministries'], 'Flower2', CURRENT_TIMESTAMP),
  ('homepage-ministry-4', 4, 'Men''s Ministries', ARRAY['Men''s Ministries'], 'Wrench', CURRENT_TIMESTAMP),
  ('homepage-ministry-5', 5, 'Camp Meeting', ARRAY['Camp Meeting'], 'Tent', CURRENT_TIMESTAMP),
  ('homepage-ministry-6', 6, 'Youth', ARRAY['Youth'], 'Sparkles', CURRENT_TIMESTAMP)
ON CONFLICT ("position") DO NOTHING;
