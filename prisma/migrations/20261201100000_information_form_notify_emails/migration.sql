-- Information form response alerts (#1222). Additive: one new column that defaults to an empty list and one new email
-- template key, so no form emails anyone until a system administrator adds an address. Applying it in production is a human step.

-- AlterTable
ALTER TABLE "InformationForm" ADD COLUMN "submissionNotifyEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'INFORMATION_FORM_SUBMITTED';
