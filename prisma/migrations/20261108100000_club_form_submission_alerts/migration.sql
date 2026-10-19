-- Club form submission alerts (#1017). Additive: one new column that defaults to an empty list and one new email template
-- key, so no form emails anyone until a system administrator adds an address. Applying it in production is a human step.

-- AlterTable
ALTER TABLE "ClubFormTemplate" ADD COLUMN "submissionNotifyEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'CLUB_FORM_SUBMITTED';
