-- Registration themes (#283, slice 2, round A): an optional event logo and banner image on a registration look. ADDITIVE ONLY:
-- two nullable columns on "RegistrationThemeVersion" (foreign keys to "EventAsset" that clear when the file is deleted), their
-- indexes, and a replacement of the version guard function so a published look's logo and banner can only be cleared, never
-- swapped. Applying it in production is a human step (back up first).

-- AlterTable
ALTER TABLE "RegistrationThemeVersion" ADD COLUMN "logoAssetId" TEXT,
ADD COLUMN "heroAssetId" TEXT;

-- CreateIndex
CREATE INDEX "RegistrationThemeVersion_logoAssetId_idx" ON "RegistrationThemeVersion"("logoAssetId");

-- CreateIndex
CREATE INDEX "RegistrationThemeVersion_heroAssetId_idx" ON "RegistrationThemeVersion"("heroAssetId");

-- AddForeignKey
ALTER TABLE "RegistrationThemeVersion" ADD CONSTRAINT "RegistrationThemeVersion_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "EventAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationThemeVersion" ADD CONSTRAINT "RegistrationThemeVersion_heroAssetId_fkey" FOREIGN KEY ("heroAssetId") REFERENCES "EventAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same rules as slice 1, plus the logo and banner columns frozen once a version leaves DRAFT.
CREATE OR REPLACE FUNCTION "RegistrationThemeVersion_guard"() RETURNS trigger AS $$
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
    -- The logo and banner are frozen with the look: they can only be cleared (the uploaded file was deleted), never swapped.
    IF (NEW."logoAssetId" IS DISTINCT FROM OLD."logoAssetId" AND NEW."logoAssetId" IS NOT NULL)
       OR (NEW."heroAssetId" IS DISTINCT FROM OLD."heroAssetId" AND NEW."heroAssetId" IS NOT NULL) THEN
      RAISE EXCEPTION 'A published registration look cannot be changed.' USING ERRCODE = '23001';
    END IF;
    IF NEW."status" <> OLD."status" AND NOT (OLD."status" = 'PUBLISHED' AND NEW."status" = 'ARCHIVED') THEN
      RAISE EXCEPTION 'A registration look only moves from published to archived.' USING ERRCODE = '23001';
    END IF;
    -- Who published it and when are frozen; the person can only be cleared (an account deleted), never changed.
    IF NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR (NEW."publishedByUserId" IS DISTINCT FROM OLD."publishedByUserId" AND NEW."publishedByUserId" IS NOT NULL) THEN
      RAISE EXCEPTION 'A published registration look cannot be published again.' USING ERRCODE = '23001';
    END IF;
    IF NEW."status" = OLD."status" AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
      RAISE EXCEPTION 'A published registration look cannot be changed.' USING ERRCODE = '23001';
    END IF;
  ELSIF NEW."status" = 'ARCHIVED' THEN
    RAISE EXCEPTION 'A draft registration look is published or discarded, not archived.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
