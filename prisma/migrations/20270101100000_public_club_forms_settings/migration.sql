-- Public Club forms page settings (#1562). Additive: one new table, nothing existing is touched.

-- CreateTable
CREATE TABLE "PublicClubFormsSetting" (
    "id" TEXT NOT NULL,
    "status" "SiteContentStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicClubFormsSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicClubFormsSetting_status_key" ON "PublicClubFormsSetting"("status");

-- Only a working copy or the live version is kept here, never a superseded one.
ALTER TABLE "PublicClubFormsSetting" ADD CONSTRAINT "PublicClubFormsSetting_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED'));
