-- Archive an event (#635): hide it without deleting. Additive only; every existing event stays unarchived (NULL).
ALTER TABLE "Event" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Event_archivedAt_idx" ON "Event"("archivedAt");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
