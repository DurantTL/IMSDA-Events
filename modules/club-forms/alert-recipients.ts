/**
 * The addresses emailed when a club form is submitted (#1017). Pure, with no server-only import, so the settings
 * component and the route share one set of rules.
 */
export const CLUB_FORM_ALERT_MAX_RECIPIENTS = 10;
const EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export type AlertRecipientsResult =
  | { ok: true; emails: string[] }
  | { ok: false; message: string };

/** One address per line (commas and semicolons also split). Lowercased, de-duplicated, at most ten. */
export function parseAlertRecipients(raw: string | string[]): AlertRecipientsResult {
  const parts = (Array.isArray(raw) ? raw : raw.split(/[\n\r,;]+/)).map((part) => part.trim()).filter(Boolean);
  const emails: string[] = [];
  for (const part of parts) {
    const email = part.toLowerCase();
    if (email.length > 160 || !EMAIL_PATTERN.test(email)) {
      return { ok: false, message: `"${part.slice(0, 60)}" is not a valid email address.` };
    }
    if (!emails.includes(email)) emails.push(email);
  }
  if (emails.length > CLUB_FORM_ALERT_MAX_RECIPIENTS) {
    return { ok: false, message: `Add at most ${CLUB_FORM_ALERT_MAX_RECIPIENTS} addresses.` };
  }
  return { ok: true, emails };
}
