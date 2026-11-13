-- Who approved a merchandise catalog and opened sales, and when (#146). Additive: two nullable columns and one foreign key.
-- Applying it in production is a human step.

-- AlterTable
ALTER TABLE "MerchandiseCatalog" ADD COLUMN "approvedByUserId" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "MerchandiseCatalog" ADD CONSTRAINT "MerchandiseCatalog_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
