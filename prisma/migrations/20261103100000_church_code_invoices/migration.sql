-- Church-sponsored promo code invoices (#399): an organization invoice for what a church's promo codes covered on a
-- general event, drafted from the code's redemptions instead of an attendance reconciliation. Nothing existing changes
-- meaning: every current version keeps its basis and its reconciliation.

-- A new way to build a version.
ALTER TYPE "InvoiceVersionBasis" ADD VALUE IF NOT EXISTS 'CHURCH_PROMO_CODES';

-- Only such a version has no reconciliation behind it. (The enum is compared as text so this statement does not need the
-- new value to be committed first.)
ALTER TABLE "InvoiceVersion" ALTER COLUMN "reconciliationVersionId" DROP NOT NULL;
ALTER TABLE "InvoiceVersion" ADD CONSTRAINT "InvoiceVersion_reconciliation_required"
  CHECK ("reconciliationVersionId" IS NOT NULL OR "basis"::text = 'CHURCH_PROMO_CODES');
