-- Email address suppression (#863): a hard bounce or spam complaint reported by SES through SNS stops all email to that address
-- until a system administrator re-enables it. Additive only: one enum, one new table, one nullable foreign key to User
-- (SET NULL). No existing row changes. Applying this in production is a human step.
CREATE TYPE "EmailSuppressionReason" AS ENUM ('BOUNCE', 'COMPLAINT');

-- CreateTable
CREATE TABLE "EmailAddressSuppression" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceProviderEventId" TEXT,
    "sourceMessageOutboxId" TEXT,
    "suppressedAt" TIMESTAMP(3) NOT NULL,
    "reenabledAt" TIMESTAMP(3),
    "reenabledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAddressSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailAddressSuppression_normalizedEmail_key" ON "EmailAddressSuppression"("normalizedEmail");

-- CreateIndex
CREATE INDEX "EmailAddressSuppression_reenabledAt_suppressedAt_idx" ON "EmailAddressSuppression"("reenabledAt", "suppressedAt");

-- AddForeignKey
ALTER TABLE "EmailAddressSuppression" ADD CONSTRAINT "EmailAddressSuppression_reenabledByUserId_fkey" FOREIGN KEY ("reenabledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

