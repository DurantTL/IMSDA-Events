-- Reservation deposit (#415). Additive only: two flags that default to false, so every
-- existing payment and attempt keeps its meaning.
ALTER TABLE "Payment" ADD COLUMN "isDeposit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PaymentAttempt" ADD COLUMN "isDeposit" BOOLEAN NOT NULL DEFAULT false;
