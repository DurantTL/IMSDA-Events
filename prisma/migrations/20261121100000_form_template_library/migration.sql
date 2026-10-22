-- Form template library (#1064): system administrators edit the registration form templates in the app. Additive only:
-- one new enum and three new columns with defaults. Every existing template and version row came from code, so the
-- CODE default is correct for all of them. Applying this in production is a human step.

-- CreateEnum
CREATE TYPE "FormTemplateSource" AS ENUM ('CODE', 'APP');

-- AlterTable
ALTER TABLE "SeededFormTemplate" ADD COLUMN     "latestSource" "FormTemplateSource" NOT NULL DEFAULT 'CODE';

-- AlterTable
ALTER TABLE "SeededFormTemplateVersion" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "source" "FormTemplateSource" NOT NULL DEFAULT 'CODE';
