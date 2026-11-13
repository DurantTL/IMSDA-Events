-- Area Coordinator item-by-item review of Monthly Records (#1701). Additive: one enum, two new tables, no change to
-- existing rows. The conference switch has no row until a Clubs Administrator turns it on, so everything stays off.
-- Applying it in production is a human step.

-- CreateEnum
CREATE TYPE "MonthlyRecordItemOutcome" AS ENUM ('OK', 'RETURNED');

-- CreateTable
CREATE TABLE "MonthlyRecordAreaReviewSetting" (
    "clubYear" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyRecordAreaReviewSetting_pkey" PRIMARY KEY ("clubYear")
);

-- CreateTable
CREATE TABLE "ClubMonthlyReportItemReview" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "outcome" "MonthlyRecordItemOutcome" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "reviewedByAccountId" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "ClubMonthlyReportItemReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubMonthlyReportItemReview_reportId_supersededAt_idx" ON "ClubMonthlyReportItemReview"("reportId", "supersededAt");

-- At most one current (not superseded) decision per record and item. Prisma cannot express a partial unique index.
CREATE UNIQUE INDEX "ClubMonthlyReportItemReview_current_key" ON "ClubMonthlyReportItemReview"("reportId", "itemKey") WHERE "supersededAt" IS NULL;

-- AddForeignKey
ALTER TABLE "ClubMonthlyReportItemReview" ADD CONSTRAINT "ClubMonthlyReportItemReview_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ClubMonthlyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMonthlyReportItemReview" ADD CONSTRAINT "ClubMonthlyReportItemReview_reviewedByAccountId_fkey" FOREIGN KEY ("reviewedByAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
