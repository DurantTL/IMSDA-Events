-- Clubs Administrator grants (#1225). Additive: one new table, nothing altered or dropped.
-- Applying it in production is a human step.

-- CreateTable
CREATE TABLE "ClubsAdministratorGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubsAdministratorGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubsAdministratorGrant_userId_key" ON "ClubsAdministratorGrant"("userId");

-- CreateIndex
CREATE INDEX "ClubsAdministratorGrant_revokedAt_idx" ON "ClubsAdministratorGrant"("revokedAt");

-- AddForeignKey
ALTER TABLE "ClubsAdministratorGrant" ADD CONSTRAINT "ClubsAdministratorGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
