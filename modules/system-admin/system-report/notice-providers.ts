import "server-only";

import { getActiveEmailProviderName, getEmailAvailability } from "@/integrations/email/provider";
import { getPrisma } from "@/lib/prisma";
import { getSquareConfiguration } from "@/modules/payments/square-config";
import {
  emailNoticeFields,
  NOTICE_LOOKBACK_MS,
  NOTICE_WINDOW_MS,
  rejectedNoticeFields,
  squareNoticeFields,
  suppressionFields,
  type EmailProviderLabel,
  type NoticeFields,
} from "./notice-signals";
import type { SignalMeta } from "./model";
import type { defineProvider, ReportContext, SignalProvider } from "./providers";

/**
 * The "Payment and email notices" checks (#1376). Read-only: times and counts only. `defineProvider` is passed in so
 * this file never imports `providers.ts` at run time (that file appends this provider, so importing it back would be a
 * cycle).
 */

const SQUARE_REJECTED_KEY = "system.payments.webhook-rejected";
const EMAIL_REJECTED_KEY = "system.email.webhook-rejected";

const m = (key: string, name: string, description: string, fixHref: string | null = null, fixLabel: string | null = null): SignalMeta => ({ key, name, description, fixHref, fixLabel });

function triedRow(key: string, readAt: Date): NoticeFields {
  return { key, checkedAt: readAt.toISOString(), whenLabel: "Tried", state: "unavailable", resultText: "This could not be read just now. It is not shown as healthy or as zero." };
}

function activeEmail(ctx: ReportContext) {
  return ctx.once("notices:email-active", async () => ({
    active: getActiveEmailProviderName() as EmailProviderLabel,
    webhookConfigured: getEmailAvailability().webhookConfigured,
  }));
}

function lastEmailNotice(ctx: ReportContext, provider: EmailProviderLabel) {
  return ctx.once(`notices:email-last:${provider}`, async () => {
    const prisma = getPrisma();
    const [last, oldestSent] = await Promise.all([
      prisma.messageProviderEvent.findFirst({ where: { provider }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
      prisma.messageOutbox.findFirst({
        where: { provider, sentAt: { gte: new Date(ctx.now.getTime() - NOTICE_WINDOW_MS) } },
        orderBy: { sentAt: "asc" },
        select: { sentAt: true },
      }),
    ]);
    return { lastNoticeAt: last?.receivedAt ?? null, oldestSentAt: oldestSent?.sentAt ?? null };
  });
}

async function emailRow(ctx: ReportContext, key: string, provider: EmailProviderLabel): Promise<NoticeFields> {
  const config = await activeEmail(ctx);
  if (!config.ok) return triedRow(key, config.readAt);
  const base = { active: config.value.active, webhookConfigured: config.value.webhookConfigured, now: ctx.now };
  // Nothing to read for a provider that is not in use, or one whose notices are not set up.
  if (config.value.active !== provider || !config.value.webhookConfigured) {
    return emailNoticeFields(key, provider, { ...base, lastNoticeAt: null, oldestSentAt: null });
  }
  const read = await lastEmailNotice(ctx, provider);
  if (!read.ok) return triedRow(key, read.readAt);
  return emailNoticeFields(key, provider, { ...base, ...read.value });
}

export function buildNoticeProviders(define: typeof defineProvider): SignalProvider[] {
  return [
    define("notices", [
      m("square-notices", "Square notices", "The last payment notice Square sent, compared with Square payments completed in the last 24 hours.", "/admin/settings", "Platform settings"),
      m("resend-notices", "Resend notices", "The last delivery notice Resend sent, compared with email sent in the last 24 hours.", "/admin/email", "Open email settings"),
      m("ses-notices", "SES notices", "The last delivery notice SES sent, compared with email sent in the last 24 hours.", "/admin/email", "Open email settings"),
      m("rejected-notices", "Rejected notices", "Square or Resend notices turned away for a bad signature in the last 7 days, read from the stored alerts.", "/admin/settings", "Platform settings"),
      m("bounces-complaints", "Bounces and complaints", "Addresses stopped after a bounce or a complaint in the last 7 days.", "/admin/email", "Open email settings"),
    ], async (ctx) => {
      const rows: NoticeFields[] = [];

      // 1. Square notices.
      const square = await ctx.once("notices:square", async () => {
        const configured = getSquareConfiguration().webhookConfigured;
        if (!configured) return { configured, lastNoticeAt: null, oldestPaymentAt: null, ignoredCount: 0 };
        const prisma = getPrisma();
        const [last, ignoredCount, oldest] = await Promise.all([
          prisma.squareWebhookEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
          prisma.squareWebhookEvent.count({ where: { status: "IGNORED", receivedAt: { gte: new Date(ctx.now.getTime() - NOTICE_LOOKBACK_MS) } } }),
          prisma.payment.findFirst({
            where: { method: "CARD_REFERENCE", status: "SUCCEEDED", receivedAt: { gte: new Date(ctx.now.getTime() - NOTICE_WINDOW_MS) } },
            orderBy: { receivedAt: "asc" },
            select: { receivedAt: true },
          }),
        ]);
        return { configured, lastNoticeAt: last?.receivedAt ?? null, oldestPaymentAt: oldest?.receivedAt ?? null, ignoredCount };
      });
      rows.push(square.ok ? squareNoticeFields("square-notices", { ...square.value, now: ctx.now }) : triedRow("square-notices", square.readAt));

      // 2 and 3. Resend and SES notices.
      rows.push(await emailRow(ctx, "resend-notices", "RESEND"));
      rows.push(await emailRow(ctx, "ses-notices", "SES"));

      // 4. Rejected notices: the alert rows are kept whether or not they are resolved.
      const rejected = await ctx.once("notices:rejected", async () => {
        const found = await getPrisma().alertNotification.findMany({
          where: { key: { in: [SQUARE_REJECTED_KEY, EMAIL_REJECTED_KEY] }, lastSentAt: { gte: new Date(ctx.now.getTime() - NOTICE_LOOKBACK_MS) } },
          select: { key: true, lastSentAt: true },
        });
        const at = (key: string) => found.find((row) => row.key === key)?.lastSentAt ?? null;
        return { squareRejectedAt: at(SQUARE_REJECTED_KEY), resendRejectedAt: at(EMAIL_REJECTED_KEY) };
      });
      const config = await activeEmail(ctx);
      rows.push(!rejected.ok
        ? triedRow("rejected-notices", rejected.readAt)
        : !config.ok
          ? triedRow("rejected-notices", config.readAt)
          : rejectedNoticeFields("rejected-notices", { ...rejected.value, active: config.value.active, now: ctx.now }));

      // 5. Bounces and complaints.
      const suppressed = await ctx.once("notices:suppressions", () =>
        getPrisma().emailAddressSuppression.groupBy({
          by: ["reason"],
          where: { suppressedAt: { gte: new Date(ctx.now.getTime() - NOTICE_LOOKBACK_MS) } },
          _count: { _all: true },
        }),
      );
      if (!suppressed.ok) rows.push(triedRow("bounces-complaints", suppressed.readAt));
      else {
        const count = (reason: string) => suppressed.value.find((group) => group.reason === reason)?._count._all ?? 0;
        rows.push(suppressionFields("bounces-complaints", { bounces: count("BOUNCE"), complaints: count("COMPLAINT"), now: ctx.now }));
      }
      return rows;
    }),
  ];
}
