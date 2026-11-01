/** The editable Platform settings fields as the form holds them: every value a string, blank meaning "not set". */
export type PlatformSettingsDraft = {
  organizationName: string;
  logoUrl: string;
  publicWebsiteUrl: string;
  defaultTimezone: string;
  defaultAttendeeEditPolicy: "TIERED" | "VERIFY_EVERY_EDIT";
  passkeyRpId: string;
  invoiceHeaderDepartment: string;
  invoiceHeaderOrganization: string;
  invoiceHeaderAddress: string;
  invoiceHeaderPhone: string;
  publicHelpPhone: string;
  publicHelpEmail: string;
  emailHeaderName: string;
  emailClubHeaderName: string;
  emailHelpEmail: string;
  emailHelpPhone: string;
};

export type PlatformSettingsField = keyof PlatformSettingsDraft;

const identityEffect = "Shown everywhere the organization appears, right away.";
const newEventEffect = "Newly created events start from this; existing events and already sent messages keep their own values.";
const homepageEffect = "Shown on the public front page right away.";
const emailLayoutEffect = "Applies to email sent after saving; messages already sent keep their header and footer.";
const invoiceEffect = "Applies to invoice PDFs made after saving; earlier PDFs keep their header.";

export const platformSettingsFieldInfo: Record<PlatformSettingsField, { label: string; effect: string }> = {
  organizationName: { label: "Organization name", effect: identityEffect },
  logoUrl: { label: "Logo URL", effect: identityEffect },
  publicWebsiteUrl: { label: "Public website", effect: identityEffect },
  defaultTimezone: { label: "Default timezone", effect: newEventEffect },
  defaultAttendeeEditPolicy: { label: "Default attendee edit verification", effect: newEventEffect },
  passkeyRpId: { label: "Passkey domain", effect: "Every existing passkey stops working." },
  invoiceHeaderDepartment: { label: "Invoice department line", effect: invoiceEffect },
  invoiceHeaderOrganization: { label: "Organization on invoices", effect: invoiceEffect },
  invoiceHeaderAddress: { label: "Invoice mailing address", effect: invoiceEffect },
  invoiceHeaderPhone: { label: "Invoice phone", effect: invoiceEffect },
  publicHelpPhone: { label: "Homepage help phone", effect: homepageEffect },
  publicHelpEmail: { label: "Homepage help email", effect: homepageEffect },
  emailHeaderName: { label: "Email header name", effect: emailLayoutEffect },
  emailClubHeaderName: { label: "Club email header name", effect: emailLayoutEffect },
  emailHelpEmail: { label: "Email footer help email", effect: emailLayoutEffect },
  emailHelpPhone: { label: "Email footer help phone", effect: emailLayoutEffect },
};

export const platformSettingsFields = Object.keys(platformSettingsFieldInfo) as PlatformSettingsField[];

const policyLabels: Record<PlatformSettingsDraft["defaultAttendeeEditPolicy"], string> = {
  VERIFY_EVERY_EDIT: "Verify every edit",
  TIERED: "Tiered by sensitivity",
};

export function displayPlatformSettingValue(field: PlatformSettingsField, value: string) {
  if (field === "defaultAttendeeEditPolicy") return policyLabels[value as keyof typeof policyLabels] ?? value;
  return value.trim() === "" ? "(blank)" : value;
}

export type PlatformSettingsChange = {
  field: PlatformSettingsField;
  label: string;
  from: string;
  to: string;
  effect: string;
};

/** Surrounding spaces are not a change (the server trims), and the passkey domain and help email are lower-cased there too. */
export function normalizePlatformSettingValue(field: PlatformSettingsField, value: string) {
  const trimmed = value.trim();
  return field === "passkeyRpId" || field === "publicHelpEmail" || field === "emailHelpEmail" ? trimmed.toLowerCase() : trimmed;
}

/** Every field whose draft value differs from the saved one, in form order, with its plain-language effect. */
export function platformSettingsChanges(saved: PlatformSettingsDraft, draft: PlatformSettingsDraft): PlatformSettingsChange[] {
  return platformSettingsFields
    .filter((field) => normalizePlatformSettingValue(field, saved[field]) !== normalizePlatformSettingValue(field, draft[field]))
    .map((field) => ({
      field,
      label: platformSettingsFieldInfo[field].label,
      from: displayPlatformSettingValue(field, saved[field]),
      to: displayPlatformSettingValue(field, draft[field]),
      effect: platformSettingsFieldInfo[field].effect,
    }));
}

/** Distinct effect sentences for a list of changes, so a success message states each effect once. */
export function platformSettingsEffects(changes: PlatformSettingsChange[]) {
  return [...new Set(changes.map((change) => change.effect))];
}
