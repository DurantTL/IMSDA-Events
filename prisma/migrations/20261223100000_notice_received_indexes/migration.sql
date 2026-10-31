-- Indexes only, no data change: lets the System report's "latest notice" reads (#1376) avoid scanning the growing notice tables.
CREATE INDEX "SquareWebhookEvent_receivedAt_idx" ON "SquareWebhookEvent"("receivedAt");
CREATE INDEX "MessageProviderEvent_provider_receivedAt_idx" ON "MessageProviderEvent"("provider", "receivedAt");
