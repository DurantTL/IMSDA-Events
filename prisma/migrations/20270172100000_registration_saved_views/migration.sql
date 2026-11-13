-- Saved views of the Registrations list (#1511): filter keys and stored values only, never registration data.
-- Additive: one new table. Applying it in production is a human step.

-- CreateTable
CREATE TABLE "RegistrationSavedView" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "sharedAt" TIMESTAMP(3),
    "sharedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistrationSavedView_eventId_shared_idx" ON "RegistrationSavedView"("eventId", "shared");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationSavedView_eventId_ownerUserId_name_key" ON "RegistrationSavedView"("eventId", "ownerUserId", "name");

-- AddForeignKey
ALTER TABLE "RegistrationSavedView" ADD CONSTRAINT "RegistrationSavedView_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationSavedView" ADD CONSTRAINT "RegistrationSavedView_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
