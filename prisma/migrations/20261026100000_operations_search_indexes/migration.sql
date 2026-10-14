-- Operations search (#180). Additive only: three indexes, no data change, no column change.
-- Registration: the canonical order inside one event (created, then id) without a sort over the whole event.
CREATE INDEX IF NOT EXISTS "Registration_eventId_createdAt_id_idx" ON "Registration"("eventId", "createdAt", "id");
-- Registration: the default order, newest submission first with unknown submission times last, as the staff lists sort.
CREATE INDEX IF NOT EXISTS "Registration_eventId_submittedAt_createdAt_id_idx" ON "Registration"("eventId", "submittedAt" DESC NULLS LAST, "createdAt" DESC, "id" DESC);
-- Refund: the money-state filter sums succeeded refunds per payment inside one event.
CREATE INDEX IF NOT EXISTS "Refund_eventId_paymentId_status_idx" ON "Refund"("eventId", "paymentId", "status");
