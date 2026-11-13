-- Event closeout sign-off (#1515): a finance admin's sign-off before an event can be Closed, and the record of a
-- reopening. Additive only: two new tables, nothing existing changes and nothing is backfilled.

-- CreateTable
CREATE TABLE "EventCloseoutSignoff" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "signedByUserId" TEXT,
    "signedByNameSnapshot" TEXT NOT NULL,
    "checklistSnapshot" JSONB NOT NULL,
    "warningsAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "transitionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventCloseoutSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCloseoutReopening" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "signoffId" TEXT,
    "reopenedByUserId" TEXT,
    "reopenedByNameSnapshot" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "transitionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventCloseoutReopening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventCloseoutSignoff_eventId_createdAt_idx" ON "EventCloseoutSignoff"("eventId", "createdAt");
CREATE INDEX "EventCloseoutReopening_eventId_createdAt_idx" ON "EventCloseoutReopening"("eventId", "createdAt");
CREATE INDEX "EventCloseoutReopening_signoffId_idx" ON "EventCloseoutReopening"("signoffId");

-- AddForeignKey
ALTER TABLE "EventCloseoutSignoff" ADD CONSTRAINT "EventCloseoutSignoff_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCloseoutReopening" ADD CONSTRAINT "EventCloseoutReopening_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCloseoutReopening" ADD CONSTRAINT "EventCloseoutReopening_signoffId_fkey" FOREIGN KEY ("signoffId") REFERENCES "EventCloseoutSignoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The reason is required and short, and a sign-off note is short.
ALTER TABLE "EventCloseoutReopening" ADD CONSTRAINT "EventCloseoutReopening_reason_check" CHECK (length(btrim("reason")) > 0 AND length("reason") <= 500);
ALTER TABLE "EventCloseoutSignoff" ADD CONSTRAINT "EventCloseoutSignoff_note_check" CHECK ("note" IS NULL OR length("note") <= 500);

-- Append-only: an UPDATE is always refused; a DELETE only when the whole event is being deleted (event deletion sets
-- `imsda.event_deletion` for its transaction). The people are plain ids with no foreign key, so deleting an account
-- never updates a row here.
CREATE FUNCTION "EventCloseoutHistory_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Event closeout history is immutable.' USING ERRCODE = '23001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(current_setting('imsda.event_deletion', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Event closeout history is deleted only with its event.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EventCloseoutSignoff_guard" BEFORE UPDATE OR DELETE ON "EventCloseoutSignoff" FOR EACH ROW EXECUTE FUNCTION "EventCloseoutHistory_guard"();
CREATE TRIGGER "EventCloseoutReopening_guard" BEFORE UPDATE OR DELETE ON "EventCloseoutReopening" FOR EACH ROW EXECUTE FUNCTION "EventCloseoutHistory_guard"();
