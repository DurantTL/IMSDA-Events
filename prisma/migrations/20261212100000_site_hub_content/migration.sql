-- CreateEnum
CREATE TYPE "SiteContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "SiteContentEditorGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteContentEditorGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteContentRevision" (
    "id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" "SiteContentStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "restoredFromId" TEXT,

    CONSTRAINT "SiteContentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteContentEditorGrant_userId_key" ON "SiteContentEditorGrant"("userId");

-- CreateIndex
CREATE INDEX "SiteContentEditorGrant_revokedAt_idx" ON "SiteContentEditorGrant"("revokedAt");

-- CreateIndex
CREATE INDEX "SiteContentRevision_status_idx" ON "SiteContentRevision"("status");

-- AddForeignKey
ALTER TABLE "SiteContentEditorGrant" ADD CONSTRAINT "SiteContentEditorGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteContentRevision" ADD CONSTRAINT "SiteContentRevision_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteContentRevision" ADD CONSTRAINT "SiteContentRevision_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one working draft and one live version at a time, even under concurrent saves or publishes (#111).
CREATE UNIQUE INDEX "SiteContentRevision_one_published" ON "SiteContentRevision"((1)) WHERE "status" = 'PUBLISHED';
CREATE UNIQUE INDEX "SiteContentRevision_one_draft" ON "SiteContentRevision"((1)) WHERE "status" = 'DRAFT';
