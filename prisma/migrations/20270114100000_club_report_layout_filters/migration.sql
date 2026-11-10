-- Saved club report layouts can also keep their role and club filters (#1762). Null for every existing layout.
ALTER TABLE "ClubReportColumnLayout" ADD COLUMN "filters" JSONB;
