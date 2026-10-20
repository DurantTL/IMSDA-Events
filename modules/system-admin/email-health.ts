import type { AttentionItem, AttentionSummary } from "@/modules/system-admin/attention-model";
import { EMAIL_PROBLEM_WINDOW_DAYS } from "@/modules/system-admin/attention-model";

/**
 * The Email health section of System management > Email (#1043). It reuses what the system administrator bell
 * (#1032) already computes (failed and bounced email in the last seven days, stuck messages, the scheduled-email
 * sweep) and never measures them a second time, so the page and the bell cannot disagree.
 *
 * Three things stay separate on purpose: whether email is switched on (delivery state, per event), whether the
 * provider is configured here (this environment), and whether mail is actually getting through (health).
 */

/** The bell items that are about email delivery, in the order the page lists them. */
const EMAIL_HEALTH_KEYS = ["email-failed", "email-stuck", "outbox-sweep", "scheduled-emails-overdue", "scheduled-emails-failed"] as const;

export type EmailHealth = {
  windowDays: number;
  /** Problems found; empty means none were found (check `partial` before reading that as all clear). */
  problems: AttentionItem[];
  /** Some checks could not be read, so the list may be missing items. */
  partial: boolean;
  generatedAt: string;
  provider: { configured: boolean; webhookConfigured: boolean; accountEmailConfigured: boolean; centralSenderSet: boolean };
};

export function buildEmailHealth(summary: AttentionSummary, provider: EmailHealth["provider"]): EmailHealth {
  const order = (key: string) => (EMAIL_HEALTH_KEYS as readonly string[]).indexOf(key);
  const problems = summary.groups
    .flatMap((group) => group.items)
    .filter((item) => order(item.key) >= 0)
    .sort((left, right) => order(left.key) - order(right.key));
  return { windowDays: EMAIL_PROBLEM_WINDOW_DAYS, problems, partial: summary.partial, generatedAt: summary.generatedAt, provider };
}
