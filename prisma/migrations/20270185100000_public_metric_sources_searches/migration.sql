-- Public analytics (#1560): three more daily counts, the referring site's host, utm campaign tags and a search that found nothing. Short normalized text, capped per day and shown only from 3 uses (docs/PUBLIC-ANALYTICS.md).
-- Additive: three enum values. Applying it in production is a human step.

-- AlterEnum
ALTER TYPE "PublicMetric" ADD VALUE 'REFERRER_SITE';
ALTER TYPE "PublicMetric" ADD VALUE 'CAMPAIGN_VISIT';
ALTER TYPE "PublicMetric" ADD VALUE 'SEARCH_NO_RESULTS';
