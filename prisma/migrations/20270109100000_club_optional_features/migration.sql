-- CreateTable
CREATE TABLE "ClubOptionalFeature" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabledByAccountId" TEXT,
    "enabledByUserId" TEXT,

    CONSTRAINT "ClubOptionalFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubOptionalFeature_organizationId_featureKey_key" ON "ClubOptionalFeature"("organizationId", "featureKey");

-- AddForeignKey
ALTER TABLE "ClubOptionalFeature" ADD CONSTRAINT "ClubOptionalFeature_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

