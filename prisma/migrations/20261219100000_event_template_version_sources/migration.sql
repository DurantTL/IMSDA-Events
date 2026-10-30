-- Event template slice 3 (#154): provenance for a template version saved from an event.
-- Additive only: one new table. No existing table or column changes, and no stored template
-- payload changes shape.

-- CreateTable
CREATE TABLE "EventTemplateVersionSource" (
    "id" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "sourceEventName" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "releaseNote" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestInput" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "exclusions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTemplateVersionSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventTemplateVersionSource_templateVersionId_key" ON "EventTemplateVersionSource"("templateVersionId");

-- CreateIndex
CREATE INDEX "EventTemplateVersionSource_sourceEventId_idx" ON "EventTemplateVersionSource"("sourceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventTemplateVersionSource_actorUserId_requestKey_key" ON "EventTemplateVersionSource"("actorUserId", "requestKey");

-- AddForeignKey
ALTER TABLE "EventTemplateVersionSource" ADD CONSTRAINT "EventTemplateVersionSource_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "EventTemplateVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTemplateVersionSource" ADD CONSTRAINT "EventTemplateVersionSource_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTemplateVersionSource" ADD CONSTRAINT "EventTemplateVersionSource_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
