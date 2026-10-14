-- Event-owned attendee hub heading and intro (#104). Additive and nullable: null
-- means the hub's standard text, which is what every existing event showed.
ALTER TABLE "Event" ADD COLUMN "hubTitle" TEXT;
ALTER TABLE "Event" ADD COLUMN "hubIntro" TEXT;
