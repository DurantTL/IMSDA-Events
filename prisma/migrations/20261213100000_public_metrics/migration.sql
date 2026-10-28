-- CreateEnum
CREATE TYPE "PublicMetric" AS ENUM ('EVENT_PAGE_VIEW', 'DIRECTORY_SEARCH', 'DIRECTORY_FILTER', 'REGISTRATION_START', 'REGISTRATION_COMPLETE', 'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'NOT_FOUND', 'IMAGE_ERROR', 'WEB_VITAL');

-- CreateTable
CREATE TABLE "PublicMetricDaily" (
    "day" DATE NOT NULL,
    "metric" "PublicMetric" NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PublicMetricDaily_pkey" PRIMARY KEY ("day","metric","dimension")
);

-- CreateIndex
CREATE INDEX "PublicMetricDaily_metric_day_idx" ON "PublicMetricDaily"("metric", "day");

