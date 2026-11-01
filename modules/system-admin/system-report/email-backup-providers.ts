import "server-only";

import { getEmailBackupStatus } from "@/integrations/email/provider";
import { getPrisma } from "@/lib/prisma";
import { SYSTEM_SETUP_STEPS } from "@/modules/setup-help/system-setup-steps";
import { BACKUP_LOOKBACK_MS, backupSentFields, backupServiceFields, backupSetupFields } from "./email-backup-signals";
import type { SignalMeta } from "./model";
import type { defineProvider, ReportContext, SignalProvider } from "./providers";

/**
 * The backup email service checks (#1444). Read-only: counts and times only. `defineProvider` is passed in so this file
 * never imports `providers.ts` at run time (that file appends this provider).
 */

const m = (key: string, name: string, description: string, fixHref: string | null = null, fixLabel: string | null = null, setup?: SignalMeta["setup"]): SignalMeta => ({ key, name, description, fixHref, fixLabel, ...(setup ? { setup } : {}) });

function triedRow(key: string, readAt: Date) {
  return { key, checkedAt: readAt.toISOString(), whenLabel: "Tried", state: "unavailable" as const, resultText: "This could not be read just now. It is not shown as healthy or as zero." };
}

/** Attempts the backup actually sent as a failover from Amazon SES (a direct tester send is not one). */
const failoverSent = (since?: Date) => ({
  provider: "RESEND",
  status: "SENT" as const,
  providerMetadata: { path: ["failover"], equals: true },
  ...(since ? { completedAt: { gte: since } } : {}),
});

export function buildEmailBackupProviders(define: typeof defineProvider): SignalProvider[] {
  return [
    define("email", [
      m("email-backup", "Backup email service", "Whether Resend is set up to take over when Amazon SES does not accept a message, and when it was last used.", null, "Set up on the server", SYSTEM_SETUP_STEPS["email-backup"]),
      m("email-backup-sent", "Emails sent by backup (7 days)", "Emails Resend sent in the last 7 days because Amazon SES did not accept them.", null, "Check Amazon SES"),
      m("email-backup-setup", "Backup email setup", "The settings and DNS records the backup needs on both services.", null, "Fixed on the server"),
    ], async (ctx: ReportContext) => {
      const use = await ctx.once("email-backup:use", async () => {
        const prisma = getPrisma();
        const [last, count] = await Promise.all([
          prisma.messageDeliveryAttempt.findFirst({ where: failoverSent(), orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
          prisma.messageDeliveryAttempt.count({ where: failoverSent(new Date(ctx.now.getTime() - BACKUP_LOOKBACK_MS)) }),
        ]);
        return { lastUsedAt: last?.completedAt ?? null, count };
      });
      return [
        use.ok ? backupServiceFields("email-backup", { status: getEmailBackupStatus(), lastUsedAt: use.value.lastUsedAt, now: ctx.now }) : triedRow("email-backup", use.readAt),
        use.ok ? backupSentFields("email-backup-sent", { count: use.value.count, now: ctx.now }) : triedRow("email-backup-sent", use.readAt),
        backupSetupFields("email-backup-setup", ctx.now),
      ];
    }),
  ];
}
