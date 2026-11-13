import { createHash } from "node:crypto";

/**
 * Where an attendee's saved profile and what they entered on a registration disagree (#1512).
 *
 * Pure: no database, no Next. The review service loads the stored profile and the stored registration answers
 * and calls this; nothing here ever reads a request body.
 *
 * What is compared (the inverse of `attendeeProfilePrefill`, and only these): name, phone, shirt size, mailing
 * address and emergency contact. Dietary and accessibility needs are health information and are never compared,
 * offered or kept: they are not in `reviewableFields`, so no answer to a dietary question can reach this code.
 * Email is never compared or changed by this feature either.
 *
 * Only REGISTRATION-scope answers are passed in. An ATTENDEE-scope answer (for example a first name on a roster
 * row) may belong to another person, such as a child, so it says nothing about the signed-in account's profile.
 */

export const reviewableFields = [
  "firstName",
  "lastName",
  "phone",
  "shirtSize",
  "mailingLine1",
  "mailingLine2",
  "mailingCity",
  "mailingRegion",
  "mailingPostalCode",
  "mailingCountry",
  "emergencyContactName",
  "emergencyContactPhone",
] as const;

export type ReviewableField = (typeof reviewableFields)[number];
export type ReviewableProfile = Record<ReviewableField, string>;

/** Address and emergency contact: shown only after the second sign-in step, and never listed for staff. */
export const personalReviewFields = [
  "mailingLine1",
  "mailingLine2",
  "mailingCity",
  "mailingRegion",
  "mailingPostalCode",
  "mailingCountry",
  "emergencyContactName",
  "emergencyContactPhone",
] as const satisfies readonly ReviewableField[];

/**
 * The only fields whose old and new values may be written to the change history. Every other row keeps the field
 * name alone. A database check enforces the same list.
 */
export const valueKeptFields = ["firstName", "lastName", "phone", "shirtSize"] as const;
export type ValueKeptField = (typeof valueKeptFields)[number];

export function isValueKeptField(field: string): field is ValueKeptField {
  return (valueKeptFields as readonly string[]).includes(field);
}

export function isPersonalReviewField(field: string): boolean {
  return (personalReviewFields as readonly string[]).includes(field);
}

export const reviewFieldLabels: Record<ReviewableField, string> = {
  firstName: "First name",
  lastName: "Last name",
  phone: "Phone",
  shirtSize: "Shirt size",
  mailingLine1: "Address line 1",
  mailingLine2: "Address line 2",
  mailingCity: "City",
  mailingRegion: "State or region",
  mailingPostalCode: "ZIP or postal code",
  mailingCountry: "Country",
  emergencyContactName: "Emergency contact name",
  emergencyContactPhone: "Emergency contact phone",
};

const otherFieldLabels: Record<string, string> = { emergencyContactRelationship: "Emergency contact relationship" };

/** The label of any history field name; an unknown one shows as written. */
export function profileFieldLabel(field: string): string {
  return (reviewFieldLabels as Record<string, string>)[field] ?? otherFieldLabels[field] ?? field;
}

type FieldSource =
  | { kind: "text"; keys: readonly string[] }
  | { kind: "address"; component: string; keys: readonly string[] };

const fieldSources: Record<ReviewableField, FieldSource> = {
  firstName: { kind: "text", keys: ["first_name", "primary_contact_first_name"] },
  lastName: { kind: "text", keys: ["last_name", "primary_contact_last_name"] },
  phone: { kind: "text", keys: ["phone", "phone_number", "attendee_phone"] },
  shirtSize: { kind: "text", keys: ["shirt_size"] },
  mailingLine1: { kind: "address", component: "line1", keys: ["address_line_1"] },
  mailingLine2: { kind: "address", component: "line2", keys: ["address_line_2"] },
  mailingCity: { kind: "address", component: "locality", keys: ["city"] },
  mailingRegion: { kind: "address", component: "region", keys: ["state"] },
  mailingPostalCode: { kind: "address", component: "postalCode", keys: ["zip"] },
  mailingCountry: { kind: "address", component: "country", keys: ["country"] },
  emergencyContactName: { kind: "text", keys: ["emergency_contact_name"] },
  emergencyContactPhone: { kind: "text", keys: ["emergency_contact_phone"] },
};

const phoneFields: readonly ReviewableField[] = ["phone", "emergencyContactPhone"];

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function enteredFor(field: ReviewableField, responses: Record<string, unknown>): string {
  const source = fieldSources[field];
  if (source.kind === "address") {
    const address = responses.mailing_address;
    if (address && typeof address === "object" && !Array.isArray(address)) {
      const component = clean((address as Record<string, unknown>)[source.component]);
      if (component) return component;
    }
  }
  for (const key of source.keys) {
    const value = clean(responses[key]);
    if (value) return value;
  }
  return "";
}

function activeFields(includePersonal: boolean): readonly ReviewableField[] {
  return includePersonal
    ? reviewableFields
    : reviewableFields.filter((field) => !isPersonalReviewField(field));
}

/** What the registration answers say for each reviewable field; an empty string means nothing was entered. */
export function enteredProfileValues(
  responses: Record<string, unknown>,
  includePersonal: boolean,
): Partial<ReviewableProfile> {
  return Object.fromEntries(
    activeFields(includePersonal).map((field) => [field, enteredFor(field, responses)]),
  );
}

function comparable(field: ReviewableField, value: string): string {
  if (phoneFields.includes(field)) {
    const digits = value.replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  }
  return clean(value).toLowerCase();
}

export type ProfileConflict = {
  field: ReviewableField;
  label: string;
  /** The saved profile's value; empty when the profile has none yet. */
  savedValue: string;
  /** What was entered on the registration. */
  enteredValue: string;
  /** "addition" when the profile has nothing saved for the field, "different" when it holds another value. */
  kind: "different" | "addition";
};

/**
 * Fields where the registration answer differs from the saved profile. An empty entered value is never a conflict:
 * leaving a question blank says nothing against the profile. A saved value that is empty with something entered is
 * offered as an addition.
 */
export function profileConflicts(
  profile: ReviewableProfile,
  responses: Record<string, unknown>,
  includePersonal: boolean,
): ProfileConflict[] {
  const entered = enteredProfileValues(responses, includePersonal);
  const conflicts: ProfileConflict[] = [];
  for (const field of activeFields(includePersonal)) {
    const enteredValue = entered[field] ?? "";
    if (!enteredValue) continue;
    const saved = clean(profile[field]);
    if (comparable(field, saved) === comparable(field, enteredValue)) continue;
    conflicts.push({
      field,
      label: reviewFieldLabels[field],
      savedValue: saved,
      enteredValue,
      kind: saved ? "different" : "addition",
    });
  }
  return conflicts;
}

/**
 * A fingerprint of the stored profile values and the entered values the review was computed from. A review
 * applied against a different fingerprint is stale: the profile or the registration answers changed since the
 * person looked. The value is a hash and carries no readable data.
 */
export function profileReviewVersion(
  profile: ReviewableProfile,
  responses: Record<string, unknown>,
  includePersonal: boolean,
): string {
  const entered = enteredProfileValues(responses, includePersonal);
  const fields = activeFields(includePersonal);
  const material = fields.map((field) => [field, clean(profile[field]), entered[field] ?? ""]);
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

export type ProfileHistoryEntry = {
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

/**
 * One history row per changed field, honouring the retention rule: name, phone and shirt size keep both values;
 * anything else keeps the field name only. A health field is dropped, so it can never be recorded by mistake.
 */
export function historyEntriesFor(
  changes: ReadonlyArray<{ field: string; oldValue: string; newValue: string }>,
): ProfileHistoryEntry[] {
  return changes
    .filter((change) => change.field !== "dietaryNeeds" && change.field !== "accessibilityNeeds")
    .map((change) => (
      isValueKeptField(change.field)
        ? { field: change.field, oldValue: change.oldValue || null, newValue: change.newValue || null }
        : { field: change.field, oldValue: null, newValue: null }
    ));
}
