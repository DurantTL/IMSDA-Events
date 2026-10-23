-- CreateEnum
CREATE TYPE "InformationFormScope" AS ENUM ('GENERAL', 'EVENT');

-- CreateEnum
CREATE TYPE "InformationFormStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "InformationFormFillAccess" AS ENUM ('ANYONE_WITH_LINK', 'SIGNED_IN');

-- CreateEnum
CREATE TYPE "InformationFormVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "InformationForm" (
    "id" TEXT NOT NULL,
    "scope" "InformationFormScope" NOT NULL,
    "eventId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "InformationFormStatus" NOT NULL DEFAULT 'DRAFT',
    "fillAccess" "InformationFormFillAccess" NOT NULL DEFAULT 'ANYONE_WITH_LINK',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "sourceTemplateVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InformationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InformationFormVersion" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "InformationFormVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InformationFormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InformationFormResponse" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "attendeeAccountId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InformationFormResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InformationForm_scope_status_updatedAt_idx" ON "InformationForm"("scope", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "InformationForm_eventId_status_updatedAt_idx" ON "InformationForm"("eventId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InformationForm_scopeKey_slug_key" ON "InformationForm"("scopeKey", "slug");

-- CreateIndex
CREATE INDEX "InformationFormVersion_formId_status_versionNumber_idx" ON "InformationFormVersion"("formId", "status", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InformationFormVersion_formId_versionNumber_key" ON "InformationFormVersion"("formId", "versionNumber");

-- CreateIndex
CREATE INDEX "InformationFormResponse_formId_submittedAt_idx" ON "InformationFormResponse"("formId", "submittedAt");

-- CreateIndex
CREATE INDEX "InformationFormResponse_versionId_idx" ON "InformationFormResponse"("versionId");

-- CreateIndex
CREATE INDEX "InformationFormResponse_attendeeAccountId_idx" ON "InformationFormResponse"("attendeeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "InformationFormResponse_formId_idempotencyKey_key" ON "InformationFormResponse"("formId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "InformationForm" ADD CONSTRAINT "InformationForm_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationForm" ADD CONSTRAINT "InformationForm_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationForm" ADD CONSTRAINT "InformationForm_sourceTemplateVersionId_fkey" FOREIGN KEY ("sourceTemplateVersionId") REFERENCES "SeededFormTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationFormVersion" ADD CONSTRAINT "InformationFormVersion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "InformationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationFormVersion" ADD CONSTRAINT "InformationFormVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationFormResponse" ADD CONSTRAINT "InformationFormResponse_formId_fkey" FOREIGN KEY ("formId") REFERENCES "InformationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationFormResponse" ADD CONSTRAINT "InformationFormResponse_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "InformationFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationFormResponse" ADD CONSTRAINT "InformationFormResponse_attendeeAccountId_fkey" FOREIGN KEY ("attendeeAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

