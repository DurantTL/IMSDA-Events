-- Registration PDF (#1082): an easy-to-read PDF copy of each registration, one row per version, stored as a
-- MessageAttachment and attached to the confirmation and the staff copy. Additive only: one new table. Applying this
-- in production is a human step.

-- CreateTable
CREATE TABLE "RegistrationPdfDocument" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "generatorVersion" INTEGER NOT NULL,
    "formVersionId" TEXT,
    "updated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationPdfDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationPdfDocument_attachmentId_key" ON "RegistrationPdfDocument"("attachmentId");

-- CreateIndex
CREATE INDEX "RegistrationPdfDocument_eventId_idx" ON "RegistrationPdfDocument"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationPdfDocument_registrationId_version_key" ON "RegistrationPdfDocument"("registrationId", "version");

-- AddForeignKey
ALTER TABLE "RegistrationPdfDocument" ADD CONSTRAINT "RegistrationPdfDocument_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationPdfDocument" ADD CONSTRAINT "RegistrationPdfDocument_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationPdfDocument" ADD CONSTRAINT "RegistrationPdfDocument_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "MessageAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
