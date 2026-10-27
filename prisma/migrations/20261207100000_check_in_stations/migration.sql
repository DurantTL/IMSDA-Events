-- Staff-run check-in station (#892). ADDITIVE ONLY: one new table with its indexes and foreign keys, and one nullable
-- "Payment"."idempotencyKey" column with a unique index (a station's cash/check retry key). No existing column is changed, so the code from before this deploy keeps working against the new schema. Applying it in
-- production is a human step (back up first).

-- CreateTable
CREATE TABLE "CheckInStation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startedByUserId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "CheckInStation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckInStation_tokenHash_key" ON "CheckInStation"("tokenHash");

-- CreateIndex
CREATE INDEX "CheckInStation_eventId_revokedAt_idx" ON "CheckInStation"("eventId", "revokedAt");

-- CreateIndex
CREATE INDEX "CheckInStation_startedByUserId_idx" ON "CheckInStation"("startedByUserId");

-- CreateIndex
CREATE INDEX "CheckInStation_revokedByUserId_idx" ON "CheckInStation"("revokedByUserId");

-- AddForeignKey
ALTER TABLE "CheckInStation" ADD CONSTRAINT "CheckInStation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInStation" ADD CONSTRAINT "CheckInStation_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInStation" ADD CONSTRAINT "CheckInStation_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
