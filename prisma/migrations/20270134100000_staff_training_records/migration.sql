-- Staff training records (#1697). Additive: one new table, nothing altered or dropped.
-- Applying it in production is a human step.

-- CreateTable
CREATE TABLE "ClubStaffTrainingRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "certificationKey" TEXT,
    "workshopCode" TEXT,
    "workshopTitle" TEXT,
    "completedOn" DATE NOT NULL,
    "signedOffBy" TEXT,
    "createdByAccountId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubStaffTrainingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubStaffTrainingRecord_organizationId_personId_idx" ON "ClubStaffTrainingRecord"("organizationId", "personId");

-- AddForeignKey
ALTER TABLE "ClubStaffTrainingRecord" ADD CONSTRAINT "ClubStaffTrainingRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubStaffTrainingRecord" ADD CONSTRAINT "ClubStaffTrainingRecord_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
