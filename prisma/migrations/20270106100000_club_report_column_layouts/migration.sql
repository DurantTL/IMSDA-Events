-- Saved column layouts for club event reports (#1671). Additive: one new table, nothing existing changes.
-- Holds column keys and order only, never attendee data.

-- CreateTable
CREATE TABLE "ClubReportColumnLayout" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdByAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubReportColumnLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubReportColumnLayout_scopeKey_audience_name_key" ON "ClubReportColumnLayout"("scopeKey", "audience", "name");
