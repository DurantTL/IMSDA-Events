-- #2054: requirement text for honors, built to hold class requirements too (#1689).
-- Additive only: one enum and two new tables; no existing table or row changes.
-- A set belongs to exactly one honor or one class level, matching its subject.
-- Re-importing changed text adds a new set and retires the old one, so there is
-- at most one current (not retired) set per honor or class level and language.

-- CreateEnum
CREATE TYPE "RequirementSubject" AS ENUM ('HONOR', 'CLASS');

-- CreateTable
CREATE TABLE "RequirementSet" (
    "id" TEXT NOT NULL,
    "subject" "RequirementSubject" NOT NULL,
    "honorId" TEXT,
    "classLevel" "ClubClassLevel",
    "language" TEXT NOT NULL DEFAULT 'en',
    "retrievedOn" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "licenseUrl" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "section" TEXT NOT NULL DEFAULT '',
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequirementSet_honorId_language_idx" ON "RequirementSet"("honorId", "language");

-- CreateIndex
CREATE INDEX "RequirementSet_classLevel_language_idx" ON "RequirementSet"("classLevel", "language");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_setId_position_key" ON "Requirement"("setId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_setId_section_number_label_key" ON "Requirement"("setId", "section", "number", "label");

-- AddForeignKey
ALTER TABLE "RequirementSet" ADD CONSTRAINT "RequirementSet_honorId_fkey" FOREIGN KEY ("honorId") REFERENCES "Honor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_setId_fkey" FOREIGN KEY ("setId") REFERENCES "RequirementSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A set names exactly one subject: an honor, or a class level.
ALTER TABLE "RequirementSet" ADD CONSTRAINT "RequirementSet_subject_check" CHECK (
  ("subject" = 'HONOR' AND "honorId" IS NOT NULL AND "classLevel" IS NULL)
  OR ("subject" = 'CLASS' AND "classLevel" IS NOT NULL AND "honorId" IS NULL)
);

-- Requirement numbers start at 1, and positions are never negative.
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_number_check" CHECK ("number" >= 1 AND "position" >= 0);

-- At most one current set per honor (or class level) and language.
CREATE UNIQUE INDEX "RequirementSet_one_current_per_honor" ON "RequirementSet"("honorId", "language") WHERE "retiredAt" IS NULL AND "honorId" IS NOT NULL;
CREATE UNIQUE INDEX "RequirementSet_one_current_per_class" ON "RequirementSet"("classLevel", "language") WHERE "retiredAt" IS NULL AND "classLevel" IS NOT NULL;
