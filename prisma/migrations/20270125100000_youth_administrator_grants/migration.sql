-- Youth Admin grants (#1685). Additive: one new table, nothing altered or dropped.
-- Applying it in production is a human step.

-- CreateTable
CREATE TABLE "YouthAdministratorGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouthAdministratorGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YouthAdministratorGrant_userId_key" ON "YouthAdministratorGrant"("userId");

-- CreateIndex
CREATE INDEX "YouthAdministratorGrant_revokedAt_idx" ON "YouthAdministratorGrant"("revokedAt");

-- AddForeignKey
ALTER TABLE "YouthAdministratorGrant" ADD CONSTRAINT "YouthAdministratorGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
