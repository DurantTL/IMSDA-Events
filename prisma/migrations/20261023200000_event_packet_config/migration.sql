-- Event-owned operational packet selections (#155). Additive and nullable: a null
-- value means "the default packet" (every section on, automatic grouping), which
-- is exactly what every existing event printed before this column existed.
ALTER TABLE "Event" ADD COLUMN "operationalPacketConfig" JSONB;
