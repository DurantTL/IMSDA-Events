-- Message file sweep and per-event storage quota (#845). Additive only: two new tables and their indexes.

CREATE TABLE "MessageFileUploadReservation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageFileUploadReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageFileStorageCleanup" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageFileStorageCleanup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageFileUploadReservation_storageKey_key" ON "MessageFileUploadReservation"("storageKey");
CREATE INDEX "MessageFileUploadReservation_eventId_idx" ON "MessageFileUploadReservation"("eventId");
CREATE INDEX "MessageFileUploadReservation_expiresAt_idx" ON "MessageFileUploadReservation"("expiresAt");

CREATE UNIQUE INDEX "MessageFileStorageCleanup_storageKey_key" ON "MessageFileStorageCleanup"("storageKey");
CREATE INDEX "MessageFileStorageCleanup_eventId_idx" ON "MessageFileStorageCleanup"("eventId");
