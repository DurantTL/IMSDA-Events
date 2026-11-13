-- Registration themes (#283, slice 1): a versioned, constrained look for an event's registration pages. ADDITIVE ONLY: one
-- enum and one new table with its indexes, foreign keys and an immutability trigger. Applying it in production is a human
-- step (back up first).

-- CreateEnum
CREATE TYPE "RegistrationThemeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "RegistrationThemeVersion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "RegistrationThemeStatus" NOT NULL DEFAULT 'DRAFT',
    "tokens" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "RegistrationThemeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationThemeVersion_eventId_versionNumber_key" ON "RegistrationThemeVersion"("eventId", "versionNumber");

-- An event has at most one draft and at most one published look at a time.
CREATE UNIQUE INDEX "RegistrationThemeVersion_one_draft_per_event" ON "RegistrationThemeVersion"("eventId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "RegistrationThemeVersion_one_published_per_event" ON "RegistrationThemeVersion"("eventId") WHERE "status" = 'PUBLISHED';

-- AddForeignKey
ALTER TABLE "RegistrationThemeVersion" ADD CONSTRAINT "RegistrationThemeVersion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationThemeVersion" ADD CONSTRAINT "RegistrationThemeVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationThemeVersion" ADD CONSTRAINT "RegistrationThemeVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Published and archived looks are history: once a version leaves DRAFT its tokens, number and event never change, it only
-- moves DRAFT -> PUBLISHED -> ARCHIVED, and it is deleted only with its event (the event deletion sets
-- `imsda.event_deletion` for its transaction). A draft can be edited and discarded freely. The people columns can still be
-- nulled when an account is deleted.
CREATE FUNCTION "RegistrationThemeVersion_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'DRAFT' OR COALESCE(current_setting('imsda.event_deletion', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'A published registration look is kept as history.' USING ERRCODE = '23001';
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."tokens" IS DISTINCT FROM OLD."tokens" OR NEW."versionNumber" <> OLD."versionNumber" OR NEW."eventId" <> OLD."eventId" THEN
      RAISE EXCEPTION 'A published registration look cannot be changed.' USING ERRCODE = '23001';
    END IF;
    IF NEW."status" <> OLD."status" AND NOT (OLD."status" = 'PUBLISHED' AND NEW."status" = 'ARCHIVED') THEN
      RAISE EXCEPTION 'A registration look only moves from published to archived.' USING ERRCODE = '23001';
    END IF;
  ELSIF NEW."status" = 'ARCHIVED' THEN
    RAISE EXCEPTION 'A draft registration look is published or discarded, not archived.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RegistrationThemeVersion_guard" BEFORE UPDATE OR DELETE ON "RegistrationThemeVersion" FOR EACH ROW EXECUTE FUNCTION "RegistrationThemeVersion_guard"();
