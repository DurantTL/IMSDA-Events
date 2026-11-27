-- #2052: a record of each printed club class or honor certificate, with a verification number,
-- so a certificate can be checked on a public page and voided by the club. Additive only: one
-- new enum and one new table; no change to any existing table or row. Nothing is stored for a
-- club that never prints a certificate.

-- CreateEnum
CREATE TYPE "ClubCertificateKind" AS ENUM ('HONOR', 'CLASS');

-- CreateTable
CREATE TABLE "ClubCertificate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "kind" "ClubCertificateKind" NOT NULL,
    "refId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "completedOn" TEXT NOT NULL,
    "clubName" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByAccountId" TEXT,
    "issuedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByAccountId" TEXT,
    "voidedByUserId" TEXT,
    "activeKey" TEXT,

    CONSTRAINT "ClubCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubCertificate_code_key" ON "ClubCertificate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ClubCertificate_activeKey_key" ON "ClubCertificate"("activeKey");

-- CreateIndex
CREATE INDEX "ClubCertificate_organizationId_idx" ON "ClubCertificate"("organizationId");

-- CreateIndex
CREATE INDEX "ClubCertificate_personId_idx" ON "ClubCertificate"("personId");

-- AddForeignKey
ALTER TABLE "ClubCertificate" ADD CONSTRAINT "ClubCertificate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubCertificate" ADD CONSTRAINT "ClubCertificate_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
