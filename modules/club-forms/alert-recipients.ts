import { validateEmail } from "@/lib/field-validation";

/**
 * The addresses emailed when a club form is submitted (#1017). Pure, with no server-only import, so the settings
 * component and the route share one set of rules.
 */
export const CLUB_FORM_ALERT_MAX_RECIPIENTS = 10;

export type AlertRecipientsResult =
  | { ok: true; emails: string[] }
  /** `reason` tells a list that is too long (decidable on its own) from an address that fails (which may be an old saved one). */
  | { ok: false; message: string; reason: "COUNT" | "ADDRESS" };

/**
 * One address per line (commas and semicolons also split). Lowercased, de-duplicated, at most ten. Each must pass the shared
 * email check (#855, #1193) unless it is one of the `stored` addresses already saved (compared lowercased), so re-saving a
 * list never fails on an old address nobody touched. The message names the address's line number, never the address.
 */
export function parseAlertRecipients(raw: string | string[], stored: readonly string[] = []): AlertRecipientsResult {
  const parts = (Array.isArray(raw) ? raw : raw.split(/[\n\r,;]+/)).map((part) => part.trim()).filter(Boolean);
  const saved = new Set(stored.map((email) => email.trim().toLowerCase()));
  const emails: string[] = [];
  for (const [index, part] of parts.entries()) {
    const email = part.toLowerCase();
    if (!saved.has(email) && !validateEmail(email).ok) {
      return { ok: false, message: `Address ${index + 1} is not a valid email address.`, reason: "ADDRESS" };
    }
    if (!emails.includes(email)) emails.push(email);
  }
  if (emails.length > CLUB_FORM_ALERT_MAX_RECIPIENTS) {
    return { ok: false, message: `Add at most ${CLUB_FORM_ALERT_MAX_RECIPIENTS} addresses.`, reason: "COUNT" };
  }
  return { ok: true, emails };
}
