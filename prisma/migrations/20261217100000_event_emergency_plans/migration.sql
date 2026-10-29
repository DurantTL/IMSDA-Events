-- Event emergency plans (#114). ADDITIVE ONLY: new enums and tables with their indexes and foreign keys. No existing table or column is changed, so the code from before this deploy keeps working against the new schema. Applying it in production is a human step (back up first).


-- CreateEnum
CREATE TYPE "EmergencyLocationKind" AS ENUM ('ASSEMBLY', 'SHELTER');

-- CreateEnum
CREATE TYPE "EmergencyProcedureKind" AS ENUM ('EVACUATION', 'SEVERE_WEATHER', 'OTHER');

-- CreateTable
CREATE TABLE "EmergencyPlan" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyPlanLocation" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "EmergencyLocationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "capacityNote" TEXT NOT NULL DEFAULT '',
    "directions" TEXT NOT NULL DEFAULT '',
    "mapReference" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "EmergencyPlanLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyPlanProcedure" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "EmergencyProcedureKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "items" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "EmergencyPlanProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyPlanContact" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "escalationOrder" INTEGER NOT NULL,

    CONSTRAINT "EmergencyPlanContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyPlanVersion" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByUserId" TEXT,

    CONSTRAINT "EmergencyPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyPlan_eventId_key" ON "EmergencyPlan"("eventId");

-- CreateIndex
CREATE INDEX "EmergencyPlanLocation_planId_sortOrder_idx" ON "EmergencyPlanLocation"("planId", "sortOrder");

-- CreateIndex
CREATE INDEX "EmergencyPlanProcedure_planId_sortOrder_idx" ON "EmergencyPlanProcedure"("planId", "sortOrder");

-- CreateIndex
CREATE INDEX "EmergencyPlanContact_planId_escalationOrder_idx" ON "EmergencyPlanContact"("planId", "escalationOrder");

-- CreateIndex
CREATE INDEX "EmergencyPlanVersion_publishedByUserId_idx" ON "EmergencyPlanVersion"("publishedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyPlanVersion_planId_versionNumber_key" ON "EmergencyPlanVersion"("planId", "versionNumber");

-- AddForeignKey
ALTER TABLE "EmergencyPlan" ADD CONSTRAINT "EmergencyPlan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlanLocation" ADD CONSTRAINT "EmergencyPlanLocation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EmergencyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlanProcedure" ADD CONSTRAINT "EmergencyPlanProcedure_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EmergencyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlanContact" ADD CONSTRAINT "EmergencyPlanContact_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EmergencyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlanVersion" ADD CONSTRAINT "EmergencyPlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EmergencyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlanVersion" ADD CONSTRAINT "EmergencyPlanVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

