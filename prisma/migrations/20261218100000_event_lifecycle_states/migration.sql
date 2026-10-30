-- Event lifecycle slice 1 (#156): explicit lifecycle states and an immutable transition history.
-- Additive only. Nothing existing changes and nothing is backfilled here: a null
-- "lifecycleState" means a legacy event whose state is derived from "isPublished" and
-- "archivedAt" (see modules/events/lifecycle-state.ts). Old code that ignores the new
-- columns keeps working, and "isPublished" stays the public-visibility column.

-- CreateEnum
CREATE TYPE "EventLifecycleState" AS ENUM ('DRAFT', 'TEST', 'PUBLISHED', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETE', 'FINANCIAL_RECONCILIATION', 'CLOSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "lifecycleState" "EventLifecycleState",
ADD COLUMN "lifecycleVersion" INTEGER NOT NULL DEFAULT 0;

-- Archive stays the "archivedAt" overlay; the stored state is never ARCHIVED.
ALTER TABLE "Event" ADD CONSTRAINT "Event_lifecycleState_not_archived" CHECK ("lifecycleState" IS NULL OR "lifecycleState" <> 'ARCHIVED');

-- CreateTable
CREATE TABLE "EventLifecycleTransition" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "fromState" "EventLifecycleState" NOT NULL,
    "toState" "EventLifecycleState" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLifecycleTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventLifecycleTransition_eventId_createdAt_idx" ON "EventLifecycleTransition"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "EventLifecycleTransition" ADD CONSTRAINT "EventLifecycleTransition_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Immutable history: an UPDATE is always refused; a DELETE only when the whole event is
-- being deleted (event deletion sets `imsda.event_deletion` for its transaction). The actor
-- is a plain id with no foreign key, so deleting an account never updates a row here.
CREATE FUNCTION "EventLifecycleTransition_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Event lifecycle history is immutable.' USING ERRCODE = '23001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(current_setting('imsda.event_deletion', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Event lifecycle history is deleted only with its event.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EventLifecycleTransition_guard" BEFORE UPDATE OR DELETE ON "EventLifecycleTransition" FOR EACH ROW EXECUTE FUNCTION "EventLifecycleTransition_guard"();
