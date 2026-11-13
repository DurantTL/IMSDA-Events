import { createHash } from "node:crypto";
import { ageOn, parseCalendarDate } from "@/modules/club-rosters/domain";
import { classifyAttendeeType } from "@/modules/attendee-types/domain";
import { BIRTH_DATE_FIELD_KEYS, todayDateValue } from "@/modules/forms/definition";

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
 * Registration-scope answers are always compared. An ATTENDEE-scope answer (for example a first name on a roster
 * row) may belong to another person, such as a child, so it is compared only when exactly one adult attendee is
 * provably the signed-in account holder (`accountHolderAttendeeIndex`). Registration answers win; the holder's
 * attendee answers only fill what the registration answers leave blank.
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

/**
 * Address and emergency contact fields a system administrator may correct. Only a STAFF_CORRECTION row keeps their old
 * and new values; every other source keeps the field name alone. The database check
 * (`AttendeeProfileChange_value_retention_check`, migration 20270178100000) lists the same names.
 */
export const staffPersonalValueFields = [
  ...personalReviewFields,
  "emergencyContactRelationship",
] as const;
export type StaffPersonalValueField = (typeof staffPersonalValueFields)[number];

export function isStaffPersonalValueField(field: string): field is StaffPersonalValueField {
  return (staffPersonalValueFields as readonly string[]).includes(field);
}

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
  firstName: { kind: "text", keys: ["first_name", "primary_contact_first_name", "primary_first_name"] },
  lastName: { kind: "text", keys: ["last_name", "primary_contact_last_name", "primary_last_name"] },
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

/**
 * What the answers say for each reviewable field; an empty string means nothing was entered. The registration answers
 * win; the account holder's attendee answers (when there is one) only fill a field the registration answers leave blank.
 */
export function enteredProfileValues(
  responses: Record<string, unknown>,
  includePersonal: boolean,
  holderResponses: Record<string, unknown> = {},
): Partial<ReviewableProfile> {
  return Object.fromEntries(
    activeFields(includePersonal).map((field) => [
      field,
      enteredFor(field, responses) || enteredFor(field, holderResponses),
    ]),
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
  holderResponses: Record<string, unknown> = {},
): ProfileConflict[] {
  const entered = enteredProfileValues(responses, includePersonal, holderResponses);
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
 * A fingerprint of the stored profile values and the entered values the review was computed from (the registration
 * answers merged with the account holder's attendee answers, as compared). A review applied against a different
 * fingerprint is stale: the profile or the answers changed since the person looked. The value is a hash and carries no readable data.
 */
export function profileReviewVersion(
  profile: ReviewableProfile,
  responses: Record<string, unknown>,
  includePersonal: boolean,
  holderResponses: Record<string, unknown> = {},
): string {
  const entered = enteredProfileValues(responses, includePersonal, holderResponses);
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
 * address and emergency contact keep them only for a STAFF_CORRECTION row; anything else keeps the field name only.
 * A health field is dropped, so it can never be recorded by mistake.
 */
export function historyEntriesFor(
  changes: ReadonlyArray<{ field: string; oldValue: string; newValue: string }>,
  source?: "SELF_EDIT" | "REGISTRATION_REVIEW" | "STAFF_CORRECTION",
): ProfileHistoryEntry[] {
  return changes
    .filter((change) => change.field !== "dietaryNeeds" && change.field !== "accessibilityNeeds")
    .map((change) => (
      isValueKeptField(change.field) || (source === "STAFF_CORRECTION" && isStaffPersonalValueField(change.field))
        ? { field: change.field, oldValue: change.oldValue || null, newValue: change.newValue || null }
        : { field: change.field, oldValue: null, newValue: null }
    ));
}

// ---------------------------------------------------------------------------------------------
// The account holder among a registration's attendees
// ---------------------------------------------------------------------------------------------

const attendeeEmailKeys = ["email", "attendee_email"] as const;
const contactFirstNameKeys = ["primary_contact_first_name", "contact_first_name", "registrant_first_name", "primary_first_name"] as const;
const contactLastNameKeys = ["primary_contact_last_name", "contact_last_name", "registrant_last_name", "primary_last_name"] as const;
const ADULT_AGE = 18;

function firstClean(responses: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = clean(responses[key]);
    if (value) return value;
  }
  return "";
}

/**
 * Whether an attendee is an adult, as far as the registration can prove it. A birth-date answer that is present
 * decides, and only a real calendar date on or before `today` showing 18 or over is an adult: an unreadable or future
 * birth date is unclear, so not an adult, and never falls through to the type. Only a fully absent birth date lets the
 * linked attendee type decide, through the shared `classifyAttendeeType` (adult means a minimum age of 18 or more and no
 * maximum under 18). No type, no age range, a younger range or an open-ended one is not an adult. Free-text labels, age
 * numbers and "minor" flags are never evidence.
 */
function isAdultAttendee(attendee: AccountHolderAttendee, today: string): boolean {
  const raw = firstClean(attendee.answers, BIRTH_DATE_FIELD_KEYS);
  if (raw) {
    if (!parseCalendarDate(raw)) return false;
    const age = ageOn(raw, today);
    return age !== null && age >= ADULT_AGE;
  }
  return attendee.type ? classifyAttendeeType(attendee.type) === "ADULT" : false;
}

/** One attendee on the registration: the attendee-scope answers and the age range of the linked attendee type. */
export type AccountHolderAttendee = {
  answers: Record<string, unknown>;
  /** The attendee's `EventAttendeeType` age range; null when there is no linked type. */
  type: { minimumAge: number | null; maximumAge: number | null } | null;
};

/**
 * The index of the one attendee who is the signed-in account holder, else null.
 *
 * An attendee counts when (a) an attendee-scope email answer equals the account's verified email, or (b) their first
 * and last name answers match the registration's primary contact name; and, in both cases, they are an adult: a
 * birth-date answer showing 18 or over, or, when there is no usable birth date, an adult attendee type (minimum age 18
 * or more). A birth date always wins over the type. A child is never the holder. If more than one attendee counts,
 * nobody does.
 */
export function accountHolderAttendeeIndex(input: {
  verifiedEmail: string;
  registrationAnswers: Record<string, unknown>;
  attendees: ReadonlyArray<AccountHolderAttendee>;
  /** Today's calendar date in America/Chicago; defaults to now. */
  today?: string;
}): number | null {
  const today = input.today ?? todayDateValue();
  const email = clean(input.verifiedEmail).toLowerCase();
  const contactFirst = firstClean(input.registrationAnswers, contactFirstNameKeys).toLowerCase();
  const contactLast = firstClean(input.registrationAnswers, contactLastNameKeys).toLowerCase();
  const holders: number[] = [];
  input.attendees.forEach((attendee, index) => {
    if (!isAdultAttendee(attendee, today)) return;
    const answers = attendee.answers;
    const emailMatch = email !== "" && attendeeEmailKeys.some((key) => clean(answers[key]).toLowerCase() === email);
    const nameMatch = contactFirst !== "" && contactLast !== ""
      && clean(answers.first_name).toLowerCase() === contactFirst
      && clean(answers.last_name).toLowerCase() === contactLast;
    if (emailMatch || nameMatch) holders.push(index);
  });
  return holders.length === 1 ? holders[0]! : null;
}
