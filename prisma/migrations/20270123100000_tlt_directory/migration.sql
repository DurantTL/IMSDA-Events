-- TLT directory (#1686). Additive only: new enum, new tables, three new columns on AreaCoordinatorGrant (the TLT director
-- setting, off for everyone), and the seeded position types and help-area tags. Drops, renames and moves nothing.

-- CreateEnum
CREATE TYPE "TltStatus" AS ENUM ('APPLIED', 'APPROVED', 'ACTIVE', 'FINISHED', 'LEFT');

-- AlterTable
ALTER TABLE "AreaCoordinatorGrant" ADD COLUMN     "tltDirector" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tltDirectorSetAt" TIMESTAMP(3),
ADD COLUMN     "tltDirectorSetByUserId" TEXT;

-- CreateTable
CREATE TABLE "TltPositionType" (
    "id" TEXT NOT NULL,
    "seedKey" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TltPositionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TltHelpTag" (
    "id" TEXT NOT NULL,
    "seedKey" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TltHelpTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TltProfile" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tltYear" INTEGER,
    "positionTypeId" TEXT,
    "status" "TltStatus",
    "updatedByAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TltProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TltProfileTag" (
    "profileId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TltProfileTag_pkey" PRIMARY KEY ("profileId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TltPositionType_seedKey_key" ON "TltPositionType"("seedKey");

-- CreateIndex
CREATE UNIQUE INDEX "TltPositionType_name_key" ON "TltPositionType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TltHelpTag_seedKey_key" ON "TltHelpTag"("seedKey");

-- CreateIndex
CREATE UNIQUE INDEX "TltHelpTag_name_key" ON "TltHelpTag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TltProfile_personId_key" ON "TltProfile"("personId");

-- CreateIndex
CREATE INDEX "TltProfile_positionTypeId_idx" ON "TltProfile"("positionTypeId");

-- CreateIndex
CREATE INDEX "TltProfileTag_tagId_idx" ON "TltProfileTag"("tagId");

-- AddForeignKey
ALTER TABLE "TltProfile" ADD CONSTRAINT "TltProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TltProfile" ADD CONSTRAINT "TltProfile_positionTypeId_fkey" FOREIGN KEY ("positionTypeId") REFERENCES "TltPositionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TltProfileTag" ADD CONSTRAINT "TltProfileTag_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TltProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TltProfileTag" ADD CONSTRAINT "TltProfileTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "TltHelpTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A TLT year is a program level, 1 to 4.
ALTER TABLE "TltProfile" ADD CONSTRAINT "TltProfile_tltYear_check" CHECK ("tltYear" IS NULL OR ("tltYear" BETWEEN 1 AND 4));

-- Seed: the NAD TLT operational departments and the TLT Opportunities help areas.
INSERT INTO "TltPositionType" ("id", "seedKey", "name", "sortOrder", "updatedAt") VALUES
  ('tltpos_administrative', 'administrative', 'Administrative', 0, CURRENT_TIMESTAMP),
  ('tltpos_ay-classwork-honors', 'ay-classwork-honors', 'AY Classwork/Honors', 1, CURRENT_TIMESTAMP),
  ('tltpos_outreach', 'outreach', 'Outreach', 2, CURRENT_TIMESTAMP),
  ('tltpos_camping-activities', 'camping-activities', 'Camping/Activities', 3, CURRENT_TIMESTAMP),
  ('tltpos_counseling', 'counseling', 'Counseling', 4, CURRENT_TIMESTAMP),
  ('tltpos_finance-clerical', 'finance-clerical', 'Finance/Clerical', 5, CURRENT_TIMESTAMP);

INSERT INTO "TltHelpTag" ("id", "seedKey", "name", "sortOrder", "updatedAt") VALUES
  ('tlttag_setup', 'setup', 'Setup', 0, CURRENT_TIMESTAMP),
  ('tlttag_photography', 'photography', 'Photography', 1, CURRENT_TIMESTAMP),
  ('tlttag_office', 'office', 'Office', 2, CURRENT_TIMESTAMP),
  ('tlttag_flag-ceremony', 'flag-ceremony', 'Flag ceremony', 3, CURRENT_TIMESTAMP),
  ('tlttag_pathfinder-song', 'pathfinder-song', 'Pathfinder Song', 4, CURRENT_TIMESTAMP),
  ('tlttag_drums', 'drums', 'Drums', 5, CURRENT_TIMESTAMP),
  ('tlttag_taps-reveille', 'taps-reveille', 'Taps or reveille', 6, CURRENT_TIMESTAMP),
  ('tlttag_bell', 'bell', 'Bell ringing', 7, CURRENT_TIMESTAMP),
  ('tlttag_mc', 'mc', 'MC', 8, CURRENT_TIMESTAMP),
  ('tlttag_praise-team', 'praise-team', 'Praise team', 9, CURRENT_TIMESTAMP),
  ('tlttag_scoring', 'scoring', 'Scoring', 10, CURRENT_TIMESTAMP),
  ('tlttag_campsite-inspection', 'campsite-inspection', 'Campsite inspection', 11, CURRENT_TIMESTAMP),
  ('tlttag_uniform-inspection', 'uniform-inspection', 'Uniform inspection', 12, CURRENT_TIMESTAMP),
  ('tlttag_trash-cleanup', 'trash-cleanup', 'Trash and clean-up', 13, CURRENT_TIMESTAMP),
  ('tlttag_awards', 'awards', 'Awards', 14, CURRENT_TIMESTAMP),
  ('tlttag_games', 'games', 'Games', 15, CURRENT_TIMESTAMP),
  ('tlttag_town-crier', 'town-crier', 'Town Crier', 16, CURRENT_TIMESTAMP);
