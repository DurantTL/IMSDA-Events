-- Alerts to a Discord channel (#2048). Add-only: new nullable or defaulted columns on the platform settings row.
ALTER TABLE "PlatformSettings"
  ADD COLUMN "sealedDiscordWebhook" TEXT,
  ADD COLUMN "discordWebhookLast4" TEXT,
  ADD COLUMN "discordWebhookSetAt" TIMESTAMP(3),
  ADD COLUMN "discordWebhookSetByUserId" TEXT,
  ADD COLUMN "discordAlertSiteHealth" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "discordAlertDeploys" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "discordAlertBackups" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "discordAlertPracticeRuns" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "discordLastDeliveredAt" TIMESTAMP(3),
  ADD COLUMN "discordLastFailedAt" TIMESTAMP(3);
