-- The public registration submission gate (#920). Additive: one table that never holds a row. A submission locks it
-- (`LOCK TABLE ... IN EXCLUSIVE MODE`) as the first statement of its SERIALIZABLE transaction, so simultaneous
-- submissions queue instead of aborting each other with serialization failures.

-- CreateTable
CREATE TABLE "PublicSubmissionGate" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "PublicSubmissionGate_pkey" PRIMARY KEY ("id")
);
