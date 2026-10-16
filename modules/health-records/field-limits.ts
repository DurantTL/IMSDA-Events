/**
 * The Health tab form's own limits and field names (domain.ts `healthRecordShape`), kept in one pure file so the
 * domain checks, the import and the browser form all use the same numbers. No database, no secrets, no I/O.
 */

export const FORM_LIMITS: Record<string, number> = {
  addressLine1: 120, addressLine2: 120, city: 80, state: 40, zip: 20, phone: 40, email: 160,
  allergyDetails: 2000, medications: 2000, medicalRestrictions: 2000,
  insuranceCompany: 160, insuranceGroupNumber: 80, insurancePolicyNumber: 80, insurancePhone: 40,
  guardianFirstName: 80, guardianLastName: 80, guardianAddress: 300, guardianPhone: 40, guardianEmail: 160,
};

export const CONTACT_LIMITS = { firstName: 80, lastName: 80, phone: 40, relationship: 80 } as const;

/** Keys of values the Health tab form would refuse as too long. Keys only, never a value. */
export function overLimitFields(values: Record<string, unknown>): string[] {
  const flagged: string[] = [];
  for (const [key, limit] of Object.entries(FORM_LIMITS)) {
    const value = values[key];
    if (typeof value === "string" && value.length > limit) flagged.push(key);
  }
  if (Array.isArray(values.emergencyContacts)) {
    values.emergencyContacts.forEach((contact, index) => {
      for (const [field, limit] of Object.entries(CONTACT_LIMITS)) {
        const value = (contact as Record<string, unknown> | null)?.[field];
        if (typeof value === "string" && value.length > limit) flagged.push(`emergencyContacts.${index}.${field}`);
      }
    });
  }
  return flagged;
}

export const HEALTH_FIELD_LABELS: Record<string, string> = {
  addressLine1: "Address line 1", addressLine2: "Address line 2", city: "City", state: "State", zip: "ZIP",
  phone: "Phone", email: "Email", lastTetanusBooster: "Date of last tetanus booster",
  allergyDetails: "Allergies, reactions, severity and normal remedy", medications: "Medications or other relevant health information",
  medicalRestrictions: "Medical restrictions", insuranceCompany: "Insurance company", insuranceGroupNumber: "Insurance group number",
  insurancePolicyNumber: "Insurance policy number", insurancePhone: "Insurance phone",
  guardianFirstName: "Guardian first name", guardianLastName: "Guardian last name", guardianAddress: "Guardian address",
  guardianPhone: "Guardian phone", guardianEmail: "Guardian email", emergencyContacts: "Emergency contacts",
  hasAllergies: "Allergies", hasInsurance: "Insurance", consent: "Consent", signature: "Signature",
  consentEmergencyTreatment: "Emergency treatment authorization", consentActivities: "Attendance and activity permission",
  consentPhotocopy: "Permission for photocopying",
};

const CONTACT_FIELD_LABELS: Record<string, string> = { firstName: "first name", lastName: "last name", phone: "phone", relationship: "relationship" };

/** "emergencyContacts.0.phone" becomes "Emergency contact 1 phone"; a plain key becomes its form label. */
export function healthFieldLabel(key: string) {
  const contact = /^emergencyContacts\.(\d+)\.(\w+)$/.exec(key);
  if (contact) return `Emergency contact ${Number(contact[1]) + 1} ${CONTACT_FIELD_LABELS[contact[2]!] ?? contact[2]}`;
  return HEALTH_FIELD_LABELS[key] ?? key;
}

/** True when a stored tetanus booster is something other than a year-month-day date (for example "2019"). */
export function tetanusNeedsCorrection(value: unknown) {
  return typeof value === "string" && value.trim() !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}
