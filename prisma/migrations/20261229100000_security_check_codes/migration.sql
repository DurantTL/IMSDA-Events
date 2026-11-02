-- The emailed code that stands in for the Security check when a privacy browser blocks it (#1480).
-- Enum values are only added here; nothing in this migration uses them.
ALTER TYPE "MessageTemplateKey" ADD VALUE IF NOT EXISTS 'SECURITY_CHECK_CODE';

-- CreateTable
CREATE TABLE "SecurityCheckCode" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "codeHash" TEXT,
    "deliveryMessageId" TEXT,
    "sealedCode" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityCheckCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityCheckCode_codeHash_key" ON "SecurityCheckCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityCheckCode_deliveryMessageId_key" ON "SecurityCheckCode"("deliveryMessageId");

-- CreateIndex
CREATE INDEX "SecurityCheckCode_action_emailHash_consumedAt_idx" ON "SecurityCheckCode"("action", "emailHash", "consumedAt");

-- CreateIndex
CREATE INDEX "SecurityCheckCode_expiresAt_idx" ON "SecurityCheckCode"("expiresAt");

-- CreateIndex
CREATE INDEX "SecurityCheckCode_codeExpiresAt_idx" ON "SecurityCheckCode"("codeExpiresAt");
