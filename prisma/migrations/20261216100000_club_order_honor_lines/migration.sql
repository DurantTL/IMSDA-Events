-- Order helper list: honors added by hand without a catalog item (#1330). ADDITIVE ONLY: one new table with its indexes and foreign keys. No existing table or column is changed, so the code from before this deploy keeps working against the new schema. Applying it in production is a human step (back up first).

-- CreateTable
CREATE TABLE "ClubOrderHonorLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "honorId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubOrderHonorLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClubOrderHonorLine_quantity_check" CHECK ("quantity" > 0)
);

-- CreateIndex
CREATE INDEX "ClubOrderHonorLine_honorId_idx" ON "ClubOrderHonorLine"("honorId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubOrderHonorLine_organizationId_honorId_key" ON "ClubOrderHonorLine"("organizationId", "honorId");

-- AddForeignKey
ALTER TABLE "ClubOrderHonorLine" ADD CONSTRAINT "ClubOrderHonorLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubOrderHonorLine" ADD CONSTRAINT "ClubOrderHonorLine_honorId_fkey" FOREIGN KEY ("honorId") REFERENCES "Honor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
