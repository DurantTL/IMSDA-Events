-- Identity slice 3 (#127): reversible soft-merge of people, and anonymization.
--
-- Additive only: two new tables, one enum, one nullable column on "Person".
-- A merge never rewrites a foreign key; it is one "PersonMerge" row linking a
-- secondary person to a primary. Nothing here deletes or edits existing rows.

CREATE TYPE "PersonMergeState" AS ENUM ('ACTIVE', 'REVERSED');

ALTER TABLE "Person" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

CREATE TABLE "PersonMerge" (
    "id" TEXT NOT NULL,
    "primaryPersonId" TEXT NOT NULL,
    "secondaryPersonId" TEXT NOT NULL,
    "state" "PersonMergeState" NOT NULL DEFAULT 'ACTIVE',
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "sourceCandidateId" TEXT,
    "priorState" JSONB NOT NULL,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reversalReason" TEXT,
    CONSTRAINT "PersonMerge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PersonMerge_distinct_people_check" CHECK ("primaryPersonId" <> "secondaryPersonId"),
    CONSTRAINT "PersonMerge_reason_check" CHECK (length(btrim("reason")) > 0),
    -- Reversal fields are present exactly when the merge is reversed.
    CONSTRAINT "PersonMerge_reversal_check" CHECK (
      ("state" = 'ACTIVE' AND "reversedAt" IS NULL AND "reversedByUserId" IS NULL AND "reversalReason" IS NULL)
      OR ("state" = 'REVERSED' AND "reversedAt" IS NOT NULL AND "reversedByUserId" IS NOT NULL AND "reversalReason" IS NOT NULL)
    )
);

CREATE TABLE "PersonAnonymization" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvalReference" TEXT NOT NULL,
    "fields" TEXT[],
    "anonymizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonAnonymization_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonMerge_primaryPersonId_state_idx" ON "PersonMerge"("primaryPersonId", "state");
CREATE INDEX "PersonMerge_secondaryPersonId_state_idx" ON "PersonMerge"("secondaryPersonId", "state");
CREATE INDEX "PersonMerge_sourceCandidateId_idx" ON "PersonMerge"("sourceCandidateId");
CREATE UNIQUE INDEX "PersonAnonymization_personId_key" ON "PersonAnonymization"("personId");

-- One ACTIVE merge per secondary person: the backstop that keeps a person from
-- having two primaries even if the advisory lock were ever bypassed.
CREATE UNIQUE INDEX "PersonMerge_one_active_per_secondary_key" ON "PersonMerge"("secondaryPersonId") WHERE "state" = 'ACTIVE';

-- Restrict: merge and anonymization history is never cascaded away with a person.
ALTER TABLE "PersonMerge" ADD CONSTRAINT "PersonMerge_primaryPersonId_fkey" FOREIGN KEY ("primaryPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonMerge" ADD CONSTRAINT "PersonMerge_secondaryPersonId_fkey" FOREIGN KEY ("secondaryPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonMerge" ADD CONSTRAINT "PersonMerge_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonMerge" ADD CONSTRAINT "PersonMerge_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonMerge" ADD CONSTRAINT "PersonMerge_sourceCandidateId_fkey" FOREIGN KEY ("sourceCandidateId") REFERENCES "PersonMatchCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonAnonymization" ADD CONSTRAINT "PersonAnonymization_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonAnonymization" ADD CONSTRAINT "PersonAnonymization_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
