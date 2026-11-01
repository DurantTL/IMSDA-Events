import type { EmailBackupStatus } from "@/integrations/email/provider";
import type { Signal } from "./model";

/**
 * Pure mappers for the backup email service rows (#1444). They read nothing and carry counts, times and fixed words
 * only: never an address, a message, a provider payload or a setting's value.
 */
export type BackupFields = Pick<Signal, "key" | "state" | "resultText" | "checkedAt" | "whenLabel"> & Partial<Pick<Signal, "noTimeLabel" | "fixHref" | "fixLabel" | "items" | "itemsLabel" | "chipLabel" | "countsTowardOverall">>;

export const BACKUP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const stamp = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const OFF_REASON: Record<NonNullable<EmailBackupStatus["reason"]>, string> = {
  not_set: "Not set up. Amazon SES is the only email service in use, so a failed send is retried on SES alone.",
  invalid_value: "Not set up: EMAIL_BACKUP_PROVIDER has a value other than resend, so the backup is off.",
  same_as_primary: "Not set up: the backup is the same service as the main one, so the backup is off.",
  primary_not_ses: "Not set up: the backup only works while EMAIL_PROVIDER is ses, so the backup is off.",
  missing_api_key: "Not set up: EMAIL_BACKUP_PROVIDER is resend but RESEND_API_KEY is missing, so the backup is off.",
};

export function backupServiceFields(
  key: string,
  input: { status: EmailBackupStatus; lastUsedAt: Date | null; now: Date },
): BackupFields {
  const { status, lastUsedAt } = input;
  if (!status.active) {
    return {
      key,
      state: status.reason === "not_set" ? "info" : "watch",
      checkedAt: input.now.toISOString(),
      whenLabel: "Checked",
      resultText: OFF_REASON[status.reason ?? "not_set"],
    };
  }
  return {
    key,
    state: "ok",
    checkedAt: lastUsedAt ? lastUsedAt.toISOString() : null,
    whenLabel: "Last used",
    noTimeLabel: "Never",
    resultText: lastUsedAt
      ? `Set up. Resend takes over if Amazon SES does not accept a message. Last used ${stamp(lastUsedAt)}.`
      : "Set up. Resend takes over if Amazon SES does not accept a message. It has not been needed yet.",
  };
}

export function backupSentFields(key: string, input: { count: number; now: Date }): BackupFields {
  const base = { key, checkedAt: input.now.toISOString(), whenLabel: "Checked" };
  if (input.count === 0) {
    return { ...base, state: "ok", resultText: "No emails were sent by the backup in the last 7 days." };
  }
  return {
    ...base,
    state: "watch",
    resultText: `${plural(input.count, "email was", "emails were")} sent by the backup (Resend) in the last 7 days because Amazon SES did not accept ${input.count === 1 ? "it" : "them"}. Check Amazon SES.`,
  };
}

/** Fixed words only: the names of settings and the DNS records to add, never a value. */
export const BACKUP_SETUP_STEPS: readonly string[] = [
  "Set EMAIL_PROVIDER=ses and add the Amazon SES settings (SES_REGION, SES_SMTP_USERNAME, SES_SMTP_PASSWORD).",
  "Set EMAIL_BACKUP_PROVIDER=resend.",
  "Set RESEND_API_KEY (an API key from Resend).",
  "Set RESEND_WEBHOOK_SECRET so Resend bounces and complaints reach the shared do-not-send list.",
  "Amazon SES: for the sending domain, add the SPF record and the three DKIM records SES shows for the verified domain.",
  "Resend: add the same sending domain in Resend, then add the SPF and DKIM records Resend shows for it. Keep one SPF record and include both services in it.",
  "Restart the app, then use Send through the backup (Resend) in the email tester to prove Resend delivers.",
];

export function backupSetupFields(key: string, now: Date): BackupFields {
  return {
    key,
    state: "info",
    checkedAt: now.toISOString(),
    whenLabel: "Checked",
    resultText: "Settings and DNS for the backup. Names only; values are never shown here.",
    items: [...BACKUP_SETUP_STEPS],
    countsTowardOverall: false,
    itemsLabel: "setup checklist",
    chipLabel: "Setup guide",
  };
}
