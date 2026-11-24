import { z } from "zod";
import { actAsActorRoleFields } from "@/modules/audit/act-as-actor-role";
import { EMAIL_FIELD_MESSAGE, isUnchangedEmail, isUnchangedPhone, normalizePhoneAnswer, PHONE_FIELD_MESSAGE, isEmail, validatePhone } from "@/lib/field-validation";


/**
 * Guardian contacts on club roster members (#510). Pure rules: the shape, light
 * validation, and who may read or change them. Nothing here touches the
 * database, so the roster dialog and the server agree on the same checks.
 *
 * Owner decision (Oct 15, 2026): every roster member, adult or minor, can
 * have emergency contacts, the director and deputy edit them, and they are in
 * the roster export. Staff-facing wording is "Emergency contact" everywhere.
 *
 * Director decision (Oct 1 and Oct 3, 2026): up to two contacts per member,
 * each with a name, relationship, email and phone, every field optional,
 * stored as plain text (not encrypted). Readable by the club's director and
 * deputy (who also edit), by every Area Coordinator, and by conference staff
 * holding VIEW_SENSITIVE_DATA. Nobody else.
 */

export const GUARDIAN_SLOTS = 2;

export const GUARDIAN_FIELDS = ["name", "relationship", "email", "phone"] as const;
export type GuardianField = (typeof GUARDIAN_FIELDS)[number];

export const guardianFieldLabels: Record<GuardianField, string> = {
  name: "Name",
  relationship: "Relationship",
  email: "Email",
  phone: "Phone",
};

/**
 * What staff see this contact called (#510, owner decision Oct 15, 2026): "Emergency contact", never
 * "Guardian". The stored model keeps its `ClubRosterGuardian` name; only the words change.
 */
export const EMERGENCY_CONTACT_TERM = { singular: "Emergency contact", plural: "Emergency contacts" } as const;

/**
 * Parent or guardian contacts (#2058): a separate set from emergency contacts, stored in `ClubRosterParent`, with the
 * same fields, limits, readers and editors. Outing permission slips go to the first parent email.
 */
export const PARENT_CONTACT_TERM = { singular: "Parent or guardian", plural: "Parents or guardians" } as const;

export type GuardianValues = Record<GuardianField, string>;

/** One stored guardian: the slot (1 or 2) and its values. */
export type GuardianRecord = GuardianValues & { position: number };

export const EMPTY_GUARDIAN: GuardianValues = { name: "", relationship: "", email: "", phone: "" };

/** The shared email check (#855, #1193); not a deliverability test. An old saved email left alone is not held against the edit. */
export function guardianEmailProblem(value: string, stored?: string): string | null {
  const email = value.trim();
  if (!email) return null;
  if (isUnchangedEmail(email, stored)) return null;
  return isEmail(email) ? null : EMAIL_FIELD_MESSAGE;
}

/** The shared phone check (#855): a US number or an international one starting with +, optional extension. */
export function guardianPhoneProblem(value: string, stored?: string): string | null {
  const phone = value.trim();
  if (!phone) return null;
  // An old saved phone left alone is not held against the edit (#855).
  if (isUnchangedPhone(phone, stored)) return null;
  return validatePhone(phone).ok ? null : PHONE_FIELD_MESSAGE;
}

/** The first problem with a guardian set's phones, slot by slot against what is stored in that slot, or null. */
export function guardianSetPhoneProblem(
  guardians: readonly Pick<GuardianValues, "phone">[],
  stored: ReadonlyArray<{ position: number; phone: string }>,
): string | null {
  for (const [index, guardian] of guardians.slice(0, GUARDIAN_SLOTS).entries()) {
    const problem = guardianPhoneProblem(guardian.phone, stored.find((record) => record.position === index + 1)?.phone);
    if (problem) return problem;
  }
  return null;
}

/** The same for emails (#1193): an old saved email in the same slot is left alone, a changed one must pass. */
export function guardianSetEmailProblem(
  guardians: readonly Pick<GuardianValues, "email">[],
  stored: ReadonlyArray<{ position: number; email: string }>,
): string | null {
  for (const [index, guardian] of guardians.slice(0, GUARDIAN_SLOTS).entries()) {
    const problem = guardianEmailProblem(guardian.email, stored.find((record) => record.position === index + 1)?.email);
    if (problem) return problem;
  }
  return null;
}

const text = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`).default("");

export const guardianInputSchema = z.object({
  name: text(120),
  relationship: text(60),
  email: text(254).refine((value) => guardianEmailProblem(value) === null, { message: EMAIL_FIELD_MESSAGE }),
  phone: text(40).refine((value) => guardianPhoneProblem(value) === null, { message: PHONE_FIELD_MESSAGE }),
}).strict();

/**
 * A guardian in a roster edit: the phone is checked against the stored one for
 * that slot where the member is loaded (#855, #1193), not here, so an old saved phone or email
 * does not block the edit.
 */
export const guardianUpdateInputSchema = guardianInputSchema.extend({ phone: text(40), email: text(254) });
export const guardiansUpdateSchema = z.array(guardianUpdateInputSchema).max(GUARDIAN_SLOTS, "A member can have two emergency contacts at most.");

/**
 * The guardian set sent with a roster add or edit: slot 1 first, slot 2
 * second. It replaces the member's whole set, so a blank slot (or a slot left
 * out) removes that guardian. Leaving `guardians` out of the request leaves
 * the stored guardians alone.
 */
export const guardiansInputSchema = z.array(guardianInputSchema).max(GUARDIAN_SLOTS, "A member can have two emergency contacts at most.");

/** The parent or guardian set (#2058): the same shape and checks as emergency contacts, with its own message. */
export const parentsInputSchema = z.array(guardianInputSchema).max(GUARDIAN_SLOTS, "A member can have two parents or guardians at most.");
export const parentsUpdateSchema = z.array(guardianUpdateInputSchema).max(GUARDIAN_SLOTS, "A member can have two parents or guardians at most.");

export type GuardianInput = z.infer<typeof guardianInputSchema>;

export function guardianIsBlank(guardian: GuardianValues) {
  return GUARDIAN_FIELDS.every((field) => !guardian[field].trim());
}

/** The non-blank guardians of a request, each with its slot number (1 or 2). */
export function guardianSlotsFrom(guardians: readonly GuardianValues[]): GuardianRecord[] {
  return guardians
    .slice(0, GUARDIAN_SLOTS)
    .map((guardian, index) => ({
      position: index + 1,
      name: guardian.name.trim(),
      relationship: guardian.relationship.trim(),
      email: guardian.email.trim(),
      phone: normalizePhoneAnswer(guardian.phone.trim()),
    }))
    .filter((guardian) => !guardianIsBlank(guardian));
}

/** Inline errors for the dialog, keyed `g1Email`, `g2Phone` and so on. */
export type GuardianFormErrors = Partial<Record<`g${1 | 2}${"Email" | "Phone"}`, string>>;

export function validateGuardianForm(
  guardians: readonly Pick<GuardianValues, "email" | "phone">[],
  stored: ReadonlyArray<{ position: number; phone: string; email?: string }> = [],
): GuardianFormErrors {
  const errors: GuardianFormErrors = {};
  guardians.slice(0, GUARDIAN_SLOTS).forEach((guardian, index) => {
    const slot = (index + 1) as 1 | 2;
    const storedSlot = stored.find((record) => record.position === slot);
    const email = guardianEmailProblem(guardian.email, storedSlot?.email);
    const phone = guardianPhoneProblem(guardian.phone, storedSlot?.phone);
    if (email) errors[`g${slot}Email`] = email;
    if (phone) errors[`g${slot}Phone`] = phone;
  });
  return errors;
}

/** Inline errors for the parents or guardians fieldset, keyed `p1Email`, `p2Phone` and so on (#2058). */
export type ParentFormErrors = Partial<Record<`p${1 | 2}${"Email" | "Phone"}`, string>>;

export function validateParentForm(
  parents: readonly Pick<GuardianValues, "email" | "phone">[],
  stored: ReadonlyArray<{ position: number; phone: string; email?: string }> = [],
): ParentFormErrors {
  const errors: ParentFormErrors = {};
  for (const [key, message] of Object.entries(validateGuardianForm(parents, stored))) {
    errors[key.replace("g", "p") as keyof ParentFormErrors] = message;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The member's own contact details (#2060)

/**
 * Optional contact details for a roster member themselves (#2060), kept apart from emergency contacts and parents:
 * their own email and phone and a mailing address (a youth's household address). Stored in `ClubRosterMemberContact`,
 * plain text, with the same readers and editors as emergency contacts.
 */
export const CONTACT_FIELDS = ["email", "phone", "addressLine1", "addressLine2", "city", "state", "postalCode"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export type ContactValues = Record<ContactField, string>;

export const contactFieldLabels: Record<ContactField, string> = {
  email: "Email",
  phone: "Phone",
  addressLine1: "Street address",
  addressLine2: "Address line 2",
  city: "City",
  state: "State",
  postalCode: "ZIP code",
};

export const EMPTY_CONTACT: ContactValues = { email: "", phone: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "" };

/** Field length caps, matching the guardian fields where they overlap (email 254, phone 40). */
export const CONTACT_MAX_LENGTHS: Record<ContactField, number> = {
  email: 254,
  phone: 40,
  addressLine1: 120,
  addressLine2: 120,
  city: 80,
  state: 2,
  postalCode: 10,
};

/** US states, DC and the territories a club's mailing address may use. */
export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD",
  "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "AS", "GU", "MP", "PR", "VI", "UM",
] as const;
const stateCodes: ReadonlySet<string> = new Set(US_STATE_CODES);

export const CONTACT_STATE_MESSAGE = "Enter a two-letter state code, such as IA or MO.";
export const CONTACT_POSTAL_CODE_MESSAGE = "Enter a 5-digit ZIP code, such as 50309, or ZIP+4, such as 50309-1234.";

/** Empty, or a two-letter US state or territory code in either case. */
export function contactStateProblem(value: string): string | null {
  const state = value.trim();
  if (!state) return null;
  return stateCodes.has(state.toUpperCase()) ? null : CONTACT_STATE_MESSAGE;
}

/** Empty, 12345, or 12345-6789. */
export function contactPostalCodeProblem(value: string): string | null {
  const zip = value.trim();
  if (!zip) return null;
  return /^\d{5}(-\d{4})?$/.test(zip) ? null : CONTACT_POSTAL_CODE_MESSAGE;
}

export function contactIsBlank(contact: Partial<ContactValues>) {
  return CONTACT_FIELDS.every((field) => !(contact[field] ?? "").trim());
}

/** The contact as it is stored: every field trimmed, the phone normalized, the state in capitals; or null when all is blank. */
export function contactToStore(contact: Partial<ContactValues>): ContactValues | null {
  if (contactIsBlank(contact)) return null;
  const value = (field: ContactField) => (contact[field] ?? "").trim();
  return {
    email: value("email"),
    phone: normalizePhoneAnswer(value("phone")),
    addressLine1: value("addressLine1"),
    addressLine2: value("addressLine2"),
    city: value("city"),
    state: value("state").toUpperCase(),
    postalCode: value("postalCode"),
  };
}

/** The first problem with a contact, keyed by the error code the repository throws, or null. A saved email or phone left alone passes. */
export function contactProblem(
  contact: Partial<ContactValues>,
  stored?: { email?: string; phone?: string } | null,
): { code: "CONTACT_EMAIL_INVALID" | "CONTACT_PHONE_INVALID" | "CONTACT_STATE_INVALID" | "CONTACT_POSTAL_CODE_INVALID"; message: string } | null {
  const email = guardianEmailProblem(contact.email ?? "", stored?.email);
  if (email) return { code: "CONTACT_EMAIL_INVALID", message: email };
  const phone = guardianPhoneProblem(contact.phone ?? "", stored?.phone);
  if (phone) return { code: "CONTACT_PHONE_INVALID", message: phone };
  const state = contactStateProblem(contact.state ?? "");
  if (state) return { code: "CONTACT_STATE_INVALID", message: state };
  const postalCode = contactPostalCodeProblem(contact.postalCode ?? "");
  if (postalCode) return { code: "CONTACT_POSTAL_CODE_INVALID", message: postalCode };
  return null;
}

const contactText = (field: ContactField) => z.string().trim().max(CONTACT_MAX_LENGTHS[field], `Keep this under ${CONTACT_MAX_LENGTHS[field]} characters.`).default("");

/** A contact in a roster add: email and phone checked here. */
export const contactInputSchema = z.object({
  email: contactText("email").refine((value) => guardianEmailProblem(value) === null, { message: EMAIL_FIELD_MESSAGE }),
  phone: contactText("phone").refine((value) => guardianPhoneProblem(value) === null, { message: PHONE_FIELD_MESSAGE }),
  addressLine1: contactText("addressLine1"),
  addressLine2: contactText("addressLine2"),
  city: contactText("city"),
  state: contactText("state").refine((value) => contactStateProblem(value) === null, { message: CONTACT_STATE_MESSAGE }),
  postalCode: contactText("postalCode").refine((value) => contactPostalCodeProblem(value) === null, { message: CONTACT_POSTAL_CODE_MESSAGE }),
}).strict();

/** A contact in a roster edit: email and phone are checked against the stored ones where the member is loaded, so an old saved value does not block the edit. */
export const contactUpdateInputSchema = contactInputSchema.extend({ email: contactText("email"), phone: contactText("phone") });

export type ContactInput = z.infer<typeof contactInputSchema>;

/** The stored contact as the dialog's values, blanks when none. */
export function contactValues(record: ContactValues | undefined): ContactValues {
  return record ? { ...record } : { ...EMPTY_CONTACT };
}

/** Inline errors for the contact details section, keyed by field. */
export type ContactFormErrors = Partial<Record<"email" | "phone" | "state" | "postalCode", string>>;

export function validateContactForm(contact: Partial<ContactValues>, stored?: { email?: string; phone?: string } | null): ContactFormErrors {
  const errors: ContactFormErrors = {};
  const email = guardianEmailProblem(contact.email ?? "", stored?.email);
  const phone = guardianPhoneProblem(contact.phone ?? "", stored?.phone);
  const state = contactStateProblem(contact.state ?? "");
  const postalCode = contactPostalCodeProblem(contact.postalCode ?? "");
  if (email) errors.email = email;
  if (phone) errors.phone = phone;
  if (state) errors.state = state;
  if (postalCode) errors.postalCode = postalCode;
  return errors;
}

/** The stored guardians as two dialog slots, filling gaps with blanks. */
export function guardianSlotValues(records: readonly GuardianRecord[] | undefined): GuardianValues[] {
  return Array.from({ length: GUARDIAN_SLOTS }, (_, index) => {
    const found = records?.find((record) => record.position === index + 1);
    return found
      ? { name: found.name, relationship: found.relationship, email: found.email, phone: found.phone }
      : { ...EMPTY_GUARDIAN };
  });
}

// ---------------------------------------------------------------------------
// Who may see or change them

export type GuardianActor =
  | { kind: "ATTENDEE"; accountId: string }
  | { kind: "STAFF_ACTING"; userId: string; actAsId: string; viaClubsAdministrator?: true; viaYouthAdministrator?: true };

export type GuardianViewer =
  /** The club's own director or deputy (or staff acting as the director): that club only, read and edit. */
  | { kind: "CLUB_LEADER"; organizationId: string; actor: GuardianActor }
  /** Any Area Coordinator, for every club, read only: coordinators need them during events. */
  | { kind: "AREA_COORDINATOR"; actor: GuardianActor }
  /** Conference staff holding VIEW_SENSITIVE_DATA (or a system administrator), read only. */
  | { kind: "STAFF"; userId: string };

/** Read access. A club leader reads their own club only. */
export function guardianViewerCanRead(viewer: GuardianViewer, organizationId: string) {
  return viewer.kind === "CLUB_LEADER" ? viewer.organizationId === organizationId : true;
}

/** Edit access: only the club's own director and deputy, for their own club. */
export function guardianViewerCanEdit(viewer: GuardianViewer, organizationId: string) {
  return viewer.kind === "CLUB_LEADER" && viewer.organizationId === organizationId;
}

/**
 * Conference staff who may read guardians: a system administrator, or anyone
 * whose active event membership carries VIEW_SENSITIVE_DATA (through its role
 * or an explicit grant). `eventId` narrows it to one event's membership, for a
 * page that is scoped to one event.
 */
export function staffHoldsSensitiveData(
  user: { globalRole?: string | null },
  memberships: ReadonlyArray<{ eventId: string; status: string; permissions: readonly string[]; roleHasSensitiveData: boolean }>,
  eventId?: string,
) {
  if (user.globalRole === "SYSTEM_ADMIN") return true;
  return memberships.some((membership) => membership.status === "ACTIVE"
    && (eventId === undefined || membership.eventId === eventId)
    && (membership.roleHasSensitiveData || membership.permissions.includes("VIEW_SENSITIVE_DATA")));
}

/** Who did it, as audit fields. No guardian value is ever part of this. */
export function guardianAuditActor(viewer: GuardianViewer): { actorUserId?: string; metadata: Record<string, string> } {
  if (viewer.kind === "STAFF") return { actorUserId: viewer.userId, metadata: { viewerKind: viewer.kind } };
  return viewer.actor.kind === "ATTENDEE"
    ? { metadata: { viewerKind: viewer.kind, actorAttendeeAccountId: viewer.actor.accountId } }
    : { actorUserId: viewer.actor.userId, metadata: { viewerKind: viewer.kind, actAsId: viewer.actor.actAsId, ...actAsActorRoleFields(viewer.actor) } };
}
