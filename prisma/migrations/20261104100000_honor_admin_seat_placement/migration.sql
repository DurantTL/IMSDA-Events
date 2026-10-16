-- A system administrator can place a youth in a full honor class, or after class changes closed (#962). The seat is marked
-- with the reason, who placed it and when; it never changes the class's seat limit. Every existing pick keeps its meaning
-- (no placement), so nothing existing changes.
ALTER TABLE "HonorEnrollment" ADD COLUMN "adminPlacementReason" TEXT;
ALTER TABLE "HonorEnrollment" ADD COLUMN "adminPlacedAt" TIMESTAMP(3);
ALTER TABLE "HonorEnrollment" ADD COLUMN "adminPlacedByUserId" TEXT;

-- A placement always carries its reason and time together, and the reason is never blank.
ALTER TABLE "HonorEnrollment" ADD CONSTRAINT "HonorEnrollment_admin_placement_complete"
  CHECK (
    ("adminPlacementReason" IS NULL AND "adminPlacedAt" IS NULL AND "adminPlacedByUserId" IS NULL)
    OR ("adminPlacementReason" IS NOT NULL AND btrim("adminPlacementReason") <> '' AND "adminPlacedAt" IS NOT NULL)
  );

CREATE INDEX "HonorEnrollment_adminPlacedByUserId_idx" ON "HonorEnrollment"("adminPlacedByUserId");

ALTER TABLE "HonorEnrollment" ADD CONSTRAINT "HonorEnrollment_adminPlacedByUserId_fkey"
  FOREIGN KEY ("adminPlacedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
