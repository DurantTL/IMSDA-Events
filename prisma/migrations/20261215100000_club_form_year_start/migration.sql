-- Club forms "Start the new year" (#1323). ADDITIVE ONLY: one new table with its foreign key. No existing column is changed, so the code from before this deploy keeps working against the new schema. Applying it in production is a human step (back up first).

-- CreateTable
CREATE TABLE "ClubFormYearStart" (
    "organizationId" TEXT NOT NULL,
    "clubYear" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedByAccountId" TEXT,
    "startedByUserId" TEXT,

    CONSTRAINT "ClubFormYearStart_pkey" PRIMARY KEY ("organizationId","clubYear")
);

-- AddForeignKey
ALTER TABLE "ClubFormYearStart" ADD CONSTRAINT "ClubFormYearStart_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

