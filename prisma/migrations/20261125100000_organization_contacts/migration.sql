-- #977: non-billing organization contacts (a church's pastor). Additive only: one new enum and
-- one new table. Nothing existing is changed or deleted, and OrganizationBillingContact (#165,
-- the treasurer and invoice recipient) is untouched.

-- CreateEnum
CREATE TYPE "OrganizationContactKind" AS ENUM ('PASTOR');

-- CreateTable
CREATE TABLE "OrganizationContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "OrganizationContactKind" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "endedByUserId" TEXT,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationContact_organizationId_kind_effectiveFrom_idx" ON "OrganizationContact"("organizationId", "kind", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "OrganizationContact" ADD CONSTRAINT "OrganizationContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationContact" ADD CONSTRAINT "OrganizationContact_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationContact" ADD CONSTRAINT "OrganizationContact_endedByUserId_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One active contact per organization and kind; the database settles two racing office saves.
CREATE UNIQUE INDEX "OrganizationContact_one_active_per_organization_kind" ON "OrganizationContact"("organizationId", "kind") WHERE "effectiveTo" IS NULL;

ALTER TABLE "OrganizationContact" ADD CONSTRAINT "OrganizationContact_effective_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "OrganizationContact" ADD CONSTRAINT "OrganizationContact_text_present" CHECK (length(btrim("name")) > 0 AND ("email" IS NULL OR length(btrim("email")) > 0));

-- A contact is never deleted, only ended.
CREATE FUNCTION "OrganizationContact_refuse_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'An organization contact is ended, never deleted.' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "OrganizationContact_no_delete" BEFORE DELETE ON "OrganizationContact" FOR EACH ROW EXECUTE FUNCTION "OrganizationContact_refuse_delete"();

-- A contact row is only ever ended, never rewritten: effectiveTo, endedByUserId and endReason may
-- go from NULL to a value; nothing else changes. A user foreign key may clear itself
-- (ON DELETE SET NULL, from inside a foreign-key action).
CREATE FUNCTION "OrganizationContact_guard_update"() RETURNS trigger AS $$
DECLARE
  user_columns CONSTANT text[] := ARRAY['createdByUserId', 'endedByUserId'];
  once_columns CONSTANT text[] := ARRAY['effectiveTo', 'endedByUserId', 'endReason'];
  column_name text;
  old_json jsonb := to_jsonb(OLD);
  new_json jsonb := to_jsonb(NEW);
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF (new_json - user_columns) = (old_json - user_columns) THEN
      FOREACH column_name IN ARRAY user_columns LOOP
        IF new_json -> column_name IS DISTINCT FROM old_json -> column_name AND new_json -> column_name <> 'null'::jsonb THEN
          RAISE EXCEPTION 'An organization contact is not rewritten.' USING ERRCODE = '23001';
        END IF;
      END LOOP;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'An organization contact is not rewritten.' USING ERRCODE = '23001';
  END IF;
  IF (new_json - once_columns) <> (old_json - once_columns) THEN
    RAISE EXCEPTION 'An organization contact is not rewritten.' USING ERRCODE = '23001';
  END IF;
  FOREACH column_name IN ARRAY once_columns LOOP
    IF old_json -> column_name <> 'null'::jsonb AND new_json -> column_name IS DISTINCT FROM old_json -> column_name THEN
      RAISE EXCEPTION 'An organization contact is not rewritten.' USING ERRCODE = '23001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "OrganizationContact_guard_update" BEFORE UPDATE ON "OrganizationContact" FOR EACH ROW EXECUTE FUNCTION "OrganizationContact_guard_update"();
