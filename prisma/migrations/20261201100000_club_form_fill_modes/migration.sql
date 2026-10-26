-- Club forms: who fills a form in, and open applications (#1229).
-- Additive: new nullable columns, one new table, one new enum value, and DROP NOT NULL on
-- ClubFormSubmission.organizationId (for a "Not listed" open application). Nothing existing is
-- rewritten or backfilled; a template with a null fillMode uses the code seed's default.

ALTER TYPE "ClubFormEntryChannel" ADD VALUE IF NOT EXISTS 'OPEN_APPLICATION';

ALTER TABLE "ClubFormTemplate"
  ADD COLUMN "fillMode" TEXT,
  ADD COLUMN "fillModeChangedAt" TIMESTAMP(3),
  ADD COLUMN "fillModeChangedByUserId" TEXT;

ALTER TABLE "ClubFormSubmission"
  ALTER COLUMN "organizationId" DROP NOT NULL,
  ADD COLUMN "unlistedClubName" TEXT,
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "ClubFormSubmission_idempotencyKey_key" ON "ClubFormSubmission"("idempotencyKey");

CREATE TABLE "ClubFormOpenLinkYear" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "clubYear" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubFormOpenLinkYear_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClubFormOpenLinkYear_templateId_clubYear_key" ON "ClubFormOpenLinkYear"("templateId", "clubYear");

ALTER TABLE "ClubFormOpenLinkYear" ADD CONSTRAINT "ClubFormOpenLinkYear_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClubFormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
