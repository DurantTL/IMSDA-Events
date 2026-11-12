-- Master Guide candidates (#1698). Additive only: one new table, its indexes and two foreign keys. It holds nothing until a
-- club switches on the optional "Master Guide tracking" feature and adds a candidate. Drops, renames and moves nothing.

-- CreateTable
CREATE TABLE "MasterGuideCandidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "startedOn" DATE NOT NULL,
    "mentorName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "clubApprovedAt" TIMESTAMP(3),
    "clubApprovedByAccountId" TEXT,
    "clubApprovedByUserId" TEXT,
    "areaApprovedAt" TIMESTAMP(3),
    "areaApprovedByAccountId" TEXT,
    "createdByAccountId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterGuideCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MasterGuideCandidate_status_idx" ON "MasterGuideCandidate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MasterGuideCandidate_organizationId_personId_key" ON "MasterGuideCandidate"("organizationId", "personId");

-- AddForeignKey
ALTER TABLE "MasterGuideCandidate" ADD CONSTRAINT "MasterGuideCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterGuideCandidate" ADD CONSTRAINT "MasterGuideCandidate_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
