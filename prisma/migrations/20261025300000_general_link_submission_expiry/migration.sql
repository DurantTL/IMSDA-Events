-- General registration link retention (#931). Additive only: two enum values. A waiting submission that nobody resolved is
-- expired 30 days after the event ends (its typed answers removed), which the table's existing CHECK constraints already allow
-- for any status other than PENDING (no payload, resolvedAt and resolution set).
ALTER TYPE "GeneralLinkSubmissionStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "GeneralLinkResolution" ADD VALUE IF NOT EXISTS 'RETENTION_EXPIRED';
