/**
 * The contact the "Forms help" popup shows (#1445). Pure and client-safe: the server reads the platform setting and
 * passes the result to the component; this file only fills the gaps and builds the tel: link.
 */
export const FORMS_HELP_FALLBACK_EMAIL = "support@imsda.org";
export const FORMS_HELP_FALLBACK_PHONE = "(515) 223-1197";

export type FormsHelpContact = { email: string; phone: string };

/** Each field falls back on its own, so a set email with no phone still shows the default phone. */
export function resolveFormsHelpContact(raw: { email?: string | null; phone?: string | null }): FormsHelpContact {
  return {
    email: raw.email?.trim() || FORMS_HELP_FALLBACK_EMAIL,
    phone: raw.phone?.trim() || FORMS_HELP_FALLBACK_PHONE,
  };
}

/** `tel:+15152231197` from the digits of a phone: 10 digits get +1, 11 digits starting with 1 keep it; anything else keeps its digits. */
export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${digits ? `+${digits}` : ""}`;
}
