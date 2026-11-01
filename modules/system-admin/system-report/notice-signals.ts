import type { Signal } from "./model";

/**
 * Pure mappers for the "Payment and email notices" checks (#1376): what the last notice, the recent sends and the
 * stored rejections add up to. They read nothing and carry counts, times and fixed words only: never an address, a
 * payload or a customer.
 */
export type NoticeFields = Pick<Signal, "key" | "state" | "resultText" | "checkedAt" | "whenLabel"> & Partial<Pick<Signal, "noTimeLabel" | "fixHref" | "fixLabel" | "needsSetup">>;

export const NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A payment or send newer than this is not yet expected to have a notice, so in-flight notices never alarm. */
export const NOTICE_GRACE_MS = 15 * 60 * 1000;
export const NOTICE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const iso = (date: Date | null) => (date ? date.toISOString() : null);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const stamp = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/**
 * Where a notice row stands, from the last notice and the NEWEST thing sent or paid in the last 24 hours that is older
 * than the 15-minute grace period. A notice before that item means notices stopped (or never came) since it.
 */
function compare(input: { lastNoticeAt: Date | null; newestDueAt: Date | null; now: Date; sentNoun: string; noticeNoun: string }) {
  const { lastNoticeAt, newestDueAt, sentNoun, noticeNoun } = input;
  const last = lastNoticeAt ? `Last ${noticeNoun} notice ${stamp(lastNoticeAt)}.` : `No ${noticeNoun} notice has ever been recorded.`;
  if (!newestDueAt) {
    return { state: "info" as const, text: `Nothing ${sentNoun} in the last 24 hours (apart from the last 15 minutes), so there is nothing to compare. ${last}` };
  }
  if (lastNoticeAt && lastNoticeAt.getTime() >= newestDueAt.getTime()) {
    return { state: "ok" as const, text: `A notice arrived after the latest thing ${sentNoun} more than 15 minutes ago. ${last}` };
  }
  return { state: "watch" as const, text: `Something was ${sentNoun} more than 15 minutes ago but no ${noticeNoun} notice has arrived since. ${last}` };
}

export function squareNoticeFields(key: string, input: { configured: boolean; lastNoticeAt: Date | null; newestPaymentAt: Date | null; ignoredCount: number; now: Date }): NoticeFields {
  if (!input.configured) {
    return { key, state: "info", checkedAt: input.now.toISOString(), whenLabel: "Checked", resultText: "Square is not set up, so no payment notices are expected.", needsSetup: true };
  }
  const result = compare({ lastNoticeAt: input.lastNoticeAt, newestDueAt: input.newestPaymentAt, now: input.now, sentNoun: "paid by Square", noticeNoun: "Square" });
  const ignored = `${plural(input.ignoredCount, "notice was", "notices were")} ignored in the last 7 days (a count only: an ignored notice is not a fault).`;
  return {
    key,
    state: result.state,
    checkedAt: iso(input.lastNoticeAt),
    whenLabel: "Last notice",
    noTimeLabel: "Never",
    resultText: `${result.text} ${ignored}`,
  };
}

export type EmailProviderLabel = "RESEND" | "SES";
const PROVIDER_WORD: Record<EmailProviderLabel, string> = { RESEND: "Resend", SES: "SES" };

export function emailNoticeFields(
  key: string,
  provider: EmailProviderLabel,
  input: { active: EmailProviderLabel; webhookConfigured: boolean; lastNoticeAt: Date | null; newestSentAt: Date | null; now: Date },
): NoticeFields {
  const word = PROVIDER_WORD[provider];
  const now = input.now.toISOString();
  if (input.active !== provider) {
    return { key, state: "info", checkedAt: now, whenLabel: "Checked", resultText: `Not in use: email is sent with ${PROVIDER_WORD[input.active]}.` };
  }
  if (!input.webhookConfigured) {
    return { key, state: "watch", checkedAt: now, whenLabel: "Checked", resultText: `${word} notices aren't set up, so bounces and complaints aren't received.`, needsSetup: true };
  }
  const result = compare({ lastNoticeAt: input.lastNoticeAt, newestDueAt: input.newestSentAt, now: input.now, sentNoun: "sent", noticeNoun: word });
  return { key, state: result.state, checkedAt: iso(input.lastNoticeAt), whenLabel: "Last notice", noTimeLabel: "Never", resultText: result.text };
}

const KEPT_NOTE = "A rejection whose alert could not be delivered is not kept.";

export function rejectedNoticeFields(
  key: string,
  input: { squareRejectedAt: Date | null; resendRejectedAt: Date | null; active: EmailProviderLabel; alertDeliveryConfigured: boolean; now: Date },
): NoticeFields {
  const { squareRejectedAt, resendRejectedAt, active, alertDeliveryConfigured } = input;
  const parts: string[] = [];
  if (squareRejectedAt) parts.push(`Square notice rejected, last at ${stamp(squareRejectedAt)}.`);
  if (resendRejectedAt) parts.push(`Resend notice rejected, last at ${stamp(resendRejectedAt)}.`);
  const latest = [squareRejectedAt, resendRejectedAt].filter((date): date is Date => date !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const base = { key, checkedAt: iso(latest) ?? input.now.toISOString(), whenLabel: latest ? "Last rejection" : "Checked" };
  if (squareRejectedAt || resendRejectedAt) {
    return {
      ...base,
      state: squareRejectedAt ? "attention" : "watch",
      resultText: `${parts.join(" ")} Within the last 7 days; check the signing key. ${KEPT_NOTE}`,
    };
  }
  if (active === "SES") {
    return {
      ...base,
      state: "info",
      resultText: `No Square or Resend rejections in the last 7 days. SES rejections are only written to the server log, so they cannot be read here. ${KEPT_NOTE}`,
    };
  }
  if (alertDeliveryConfigured) {
    return {
      ...base,
      state: "info",
      resultText: `No rejected Square or Resend notices stored in the last 7 days. An alert webhook is set up, and a rejection whose alert could not be delivered is not kept, so this cannot show that none happened.`,
    };
  }
  return { ...base, state: "ok", resultText: `No rejected Square or Resend notices in the last 7 days. No alert webhook is set up, so every rejection is kept.` };
}

export function suppressionFields(key: string, input: { bounces: number; complaints: number; now: Date }): NoticeFields {
  return {
    key,
    state: "info",
    checkedAt: input.now.toISOString(),
    whenLabel: "Checked",
    resultText: `In the last 7 days: ${plural(input.bounces, "address stopped after a bounce", "addresses stopped after a bounce")}, ${plural(input.complaints, "after a complaint", "after complaints")}. Counts only.`,
  };
}
