-- Club form links: who sent the link (#1221).
-- Additive: one nullable column. Nothing existing is changed or backfilled; links
-- made before this are null (sent by the club's director or deputy, as only they could).
ALTER TABLE "ClubFormLink" ADD COLUMN "createdAs" TEXT;
