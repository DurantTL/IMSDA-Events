-- Form template source tracking (#1065): a registration form records the immutable template version it was created from
-- or last had its draft replaced from, and the newer template version whose "template changed" notice was dismissed.
-- Additive only: two nullable columns and two foreign keys to the existing SeededFormTemplateVersion table. Every
-- existing form has no known source (both null), so nothing is shown for it. Applying this in production is a human step.

-- AlterTable
ALTER TABLE "RegistrationForm" ADD COLUMN     "dismissedTemplateVersionId" TEXT,
ADD COLUMN     "sourceTemplateVersionId" TEXT;

-- AddForeignKey
ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_sourceTemplateVersionId_fkey" FOREIGN KEY ("sourceTemplateVersionId") REFERENCES "SeededFormTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_dismissedTemplateVersionId_fkey" FOREIGN KEY ("dismissedTemplateVersionId") REFERENCES "SeededFormTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
