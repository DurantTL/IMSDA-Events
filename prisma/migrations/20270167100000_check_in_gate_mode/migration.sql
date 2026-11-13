-- Optional gate mode on the check-in station (#1684). ADDITIVE ONLY: one boolean column on "Event" (default false, so
-- every existing event is unchanged) and one new table with its indexes and foreign keys. Applying it in production is
-- a human step (back up first).

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "checkInGateModeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CheckInGateArrival" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attendeeId" TEXT NOT NULL,
    "stationId" TEXT,
    "recordedByUserId" TEXT,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "CheckInGateArrival_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckInGateArrival_idempotencyKey_key" ON "CheckInGateArrival"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CheckInGateArrival_eventId_attendeeId_idx" ON "CheckInGateArrival"("eventId", "attendeeId");

-- CreateIndex
CREATE INDEX "CheckInGateArrival_attendeeId_idx" ON "CheckInGateArrival"("attendeeId");

-- CreateIndex
CREATE INDEX "CheckInGateArrival_stationId_idx" ON "CheckInGateArrival"("stationId");

-- CreateIndex
CREATE INDEX "CheckInGateArrival_recordedByUserId_idx" ON "CheckInGateArrival"("recordedByUserId");

-- AddForeignKey
ALTER TABLE "CheckInGateArrival" ADD CONSTRAINT "CheckInGateArrival_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGateArrival" ADD CONSTRAINT "CheckInGateArrival_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "RegistrationAttendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGateArrival" ADD CONSTRAINT "CheckInGateArrival_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "CheckInStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGateArrival" ADD CONSTRAINT "CheckInGateArrival_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
