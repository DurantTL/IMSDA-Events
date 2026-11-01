/**
 * The values behind the shared email layout (#1443) that an administrator edits on Platform settings: the header name
 * (one for event and general mail, one for club mail) and the footer help contact. Pure and free of I/O so the settings
 * form (for its live preview), the server validation and the renderer all use the same rules.
 */

import { validateEmail, validatePhone } from "@/lib/field-validation";

export const DEFAULT_EMAIL_HEADER_NAME = "IMSDA Events";
export const DEFAULT_EMAIL_CLUB_HEADER_NAME = "IMSDA Events";
export const DEFAULT_EMAIL_HELP_EMAIL = "support@imsda.org";
export const DEFAULT_EMAIL_HELP_PHONE = "(515) 223-1197";

/** A header name is one short line: it sits next to the mark and must not wrap the header bar. */
export const EMAIL_HEADER_NAME_MAX_LENGTH = 40;
export const EMAIL_HELP_EMAIL_MAX_LENGTH = 200;

/** The text under the name in the header, the same in every email. */
export const EMAIL_HEADER_SUBLINE = "Iowa-Missouri Conference";
export const EMAIL_SENDER_ORGANIZATION = "Iowa-Missouri Conference of Seventh-day Adventists";

/**
 * What the layout reads. `helpEmail` and `helpPhone` are null when the administrator cleared them, which is different
 * from "not loaded yet" (the defaults above): a cleared contact is left out of the footer, never replaced.
 */
export type EmailLayoutSettings = {
  /** Header name for event and general emails. */
  headerName: string;
  /** Header name for club emails. */
  clubHeaderName: string;
  helpEmail: string | null;
  helpPhone: string | null;
};

export const DEFAULT_EMAIL_LAYOUT_SETTINGS: EmailLayoutSettings = {
  headerName: DEFAULT_EMAIL_HEADER_NAME,
  clubHeaderName: DEFAULT_EMAIL_CLUB_HEADER_NAME,
  helpEmail: DEFAULT_EMAIL_HELP_EMAIL,
  helpPhone: DEFAULT_EMAIL_HELP_PHONE,
};

/** The two settings columns' names are `email*`; this is the one place that maps them to the layout's words. */
export type EmailLayoutSettingsRow = {
  emailHeaderName?: string | null;
  emailClubHeaderName?: string | null;
  emailHelpEmail?: string | null;
  emailHelpPhone?: string | null;
};

function nameOrDefault(value: string | null | undefined, fallback: string) {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, EMAIL_HEADER_NAME_MAX_LENGTH) : fallback;
}

/**
 * A stored row to the settings the layout uses. A field that is absent (undefined: the row or column is not there)
 * takes its default; one that is null was cleared on purpose and stays empty. A name can never be empty.
 */
export function emailLayoutSettingsFromRow(row: EmailLayoutSettingsRow | null | undefined): EmailLayoutSettings {
  if (!row) return DEFAULT_EMAIL_LAYOUT_SETTINGS;
  const contact = (value: string | null | undefined, fallback: string | null) => (
    value === undefined ? fallback : value?.trim() || null
  );
  return {
    headerName: nameOrDefault(row.emailHeaderName, DEFAULT_EMAIL_HEADER_NAME),
    clubHeaderName: nameOrDefault(row.emailClubHeaderName, DEFAULT_EMAIL_CLUB_HEADER_NAME),
    helpEmail: contact(row.emailHelpEmail, DEFAULT_EMAIL_HELP_EMAIL),
    helpPhone: contact(row.emailHelpPhone, DEFAULT_EMAIL_HELP_PHONE),
  };
}

export type HeaderNameCheck = { ok: true; value: string } | { ok: false; message: string };

/** A header name: 1 to 40 characters on one line, no control characters. Spaces are tidied. */
export function checkEmailHeaderName(raw: string): HeaderNameCheck {
  const text = raw.replace(/\s+/g, " ").trim();
  if (/[\u0000-\u001f\u007f]/.test(raw.replace(/[\t\r\n]/g, " "))) return { ok: false, message: "Use letters, numbers and punctuation only." };
  if (text.length < 1) return { ok: false, message: "Enter a name." };
  if (text.length > EMAIL_HEADER_NAME_MAX_LENGTH) {
    return { ok: false, message: `Use ${EMAIL_HEADER_NAME_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, value: text };
}

/** The footer help email through the shared email check, in lower case. Blank is allowed (it is left out). */
export function checkEmailHelpEmail(raw: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  const check = validateEmail(text);
  return check.ok ? { ok: true, value: check.value.toLowerCase() } : { ok: false, message: "Enter a valid email address." };
}

/** The footer help phone through the shared phone check. Blank is allowed (it is left out). */
export function checkEmailHelpPhone(raw: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  const check = validatePhone(text);
  return check.ok ? { ok: true, value: check.value } : { ok: false, message: "Enter a valid phone number, like (515) 555-0100." };
}

/**
 * The footer's help sentence, or null when there is nothing honest to say. No placeholder is ever invented: with no
 * contact set, "Reply to this email for help." appears only when a reply-to address is on the message (so a reply
 * reaches a monitored inbox), and otherwise the line is left out.
 */
export function emailHelpLine(input: {
  email: string | null;
  phone: string | null;
  /** The message's reply-to address; its presence is what makes "Reply to this email" true. */
  replyToEmail?: string | null;
}) {
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;
  if (email && phone) return `Need help? Call ${phone} or email ${email}.`;
  if (email) return `Need help? Email ${email}.`;
  if (phone) return `Need help? Call ${phone}.`;
  return input.replyToEmail?.trim() ? "Reply to this email for help." : null;
}
