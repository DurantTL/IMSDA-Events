-- Additive: the latest run's counts for a scheduled job (calendar feed refresh, message file cleanup, connection tests).
-- Counts and fixed words only: no file names, paths, addresses or keys. Existing rows keep NULL.
ALTER TABLE "SystemJobHeartbeat" ADD COLUMN "lastSummary" JSONB;
