-- Promo codes restricted to attendee types (#102). Additive: two new columns with empty defaults, nothing altered or
-- dropped. An empty list means "every attendee type", so every existing code and redemption behaves exactly as before.
-- Applying it in production is a human step.

-- AlterTable
ALTER TABLE "PromoCode" ADD COLUMN "attendeeTypeCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PromoCodeRedemption" ADD COLUMN "attendeeTypeCodesSnapshot" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
