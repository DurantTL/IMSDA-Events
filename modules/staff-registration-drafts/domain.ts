import { formatPersonName } from "@/lib/person-name";
import { emailAddressSchema } from "@/lib/field-validation";
import { getAttendeeRosterConfig, isInformationField, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { draftExcludedKeys, sanitizeDraftContent } from "@/modules/forms/public-draft";
import { extractPublicContactIdentity, type PublicRegistrationIssue } from "@/modules/forms/public-domain";
import type { StatusWord } from "@/modules/registrations/status-words";

/**
 * Registrations staff start for someone by phone, on paper or at the door (#1510).
 *
 * A draft holds only the answers the browser-draft rule allows (`modules/forms/public-draft.ts`: "save less"), pinned to
 * the form version it was started on. It never makes a registration, a payment or a charge. Staff can run the public
 * form's own checks on it without saving anything, then send the registrant ONE private link; the registrant finishes the
 * ordinary public form and submits it, and that submit links the registration back to the draft.
 */

export const STAFF_DRAFT_SOURCES = ["PHONE", "PAPER", "WALK_IN"] as const;
export type StaffDraftSource = (typeof STAFF_DRAFT_SOURCES)[number];

export const STAFF_DRAFT_STATUSES = ["OPEN", "HANDED_OFF", "SUBMITTED", "DISCARDED"] as const;
export type StaffDraftStatus = (typeof STAFF_DRAFT_STATUSES)[number];

export const STAFF_DRAFT_SOURCE_LABELS: Record<StaffDraftSource, string> = {
  PHONE: "Phone",
  PAPER: "Paper form",
  WALK_IN: "Walk-in",
};

/**
 * The status word on a draft's chip (#1453, site rule B12): one of the agreed words, never a word of its own. A draft not yet
 * sent, or sent to the registrant, is still a Draft; a sent registration is Submitted; a discarded draft is Cancelled. What
 * happened to it (who has it, who sent it) is said in plain words beside the chip, by `staffDraftStatusDetail`.
 */
export const STAFF_DRAFT_STATUS_WORDS = {
  OPEN: "Draft",
  HANDED_OFF: "Draft",
  SUBMITTED: "Submitted",
  DISCARDED: "Cancelled",
} as const satisfies Record<StaffDraftStatus, StatusWord>;

/** The shared `.status-chip` color for each word: gold for a draft still waiting, green once sent, neutral when discarded (as other Cancelled chips are). */
export const STAFF_DRAFT_STATUS_TONES = {
  OPEN: "gold",
  HANDED_OFF: "gold",
  SUBMITTED: "green",
  DISCARDED: "neutral",
} as const satisfies Record<StaffDraftStatus, "gold" | "green" | "neutral">;

export function staffDraftStatusWord(status: StaffDraftStatus): StatusWord {
  return STAFF_DRAFT_STATUS_WORDS[status];
}

/**
 * What happened to the draft, in plain words beside its status chip (#1510): not sent yet, link sent to the registrant, or
 * who sent the registration. A registration staff sent themselves names the staff member; a registrant's own submit does not.
 */
export function staffDraftStatusDetail(status: StaffDraftStatus, submittedByStaffName: string | null | undefined) {
  switch (status) {
    case "OPEN":
      return "Not sent yet";
    case "HANDED_OFF":
      return "Link sent to the registrant";
    case "SUBMITTED":
      return submittedByStaffName ? `Sent by staff (${submittedByStaffName})` : "Sent by the registrant";
    case "DISCARDED":
      return "Discarded";
  }
}

/** The private link works for 14 days, the same window as a browser draft. */
export const STAFF_DRAFT_LINK_LIFETIME_DAYS = 14;
const dayMilliseconds = 24 * 60 * 60 * 1000;

export function staffDraftLinkExpiry(now: Date) {
  return new Date(now.getTime() + STAFF_DRAFT_LINK_LIFETIME_DAYS * dayMilliseconds);
}

export const STAFF_DRAFT_REGISTRANT_FILLS_IN = "The registrant fills this in.";
export const STAFF_DRAFT_ROSTER_NOTE =
  "Add the people attending. For each person a draft keeps only their name, attendee type, shirt size and paid or limited choices; the registrant fills in the rest.";
export const STAFF_DRAFT_FORM_CHANGED = "The form changed; reopen the draft.";
export const STAFF_DRAFT_LINK_UNAVAILABLE = "This link has been used or has expired. Contact the event office.";

/** The most an answer may hold. A saveable answer is short by rule; this only bounds what the server will keep. */
const MAX_ANSWER_LENGTH = 1_000;
const MAX_ANSWER_COUNT = 200;

export type StaffDraftPlanField = {
  field: RegistrationFormField;
  /** False for a field the registrant has to fill in themselves (medical, consent, signature, payment, birth date, notes and so on). */
  editable: boolean;
};

export type StaffDraftPlanSection = {
  id: string;
  title: string;
  fields: StaffDraftPlanField[];
};

/**
 * What staff may type and what they may not, for the form's published definition. On a form with an attendee roster the
 * registration-scope questions are the sections, and the per-person questions are `attendeeFields` (#1510): staff enter
 * the people attending, keeping only what a browser draft may keep about a person.
 */
export function staffDraftPlan(definition: RegistrationFormDefinition) {
  const roster = getAttendeeRosterConfig(definition);
  const rosterEnabled = roster.enabled;
  const excluded = draftExcludedKeys(definition);
  const sections: StaffDraftPlanSection[] = definition.sections
    .map((section) => ({
      id: section.id,
      title: section.title,
      fields: section.fields
        .filter((field) => !isInformationField(field) && !(rosterEnabled && field.scope === "ATTENDEE"))
        .map((field) => ({ field, editable: !excluded.has(field.key) })),
    }))
    .filter((section) => section.fields.length > 0);
  const attendeeFields: StaffDraftPlanField[] = rosterEnabled
    ? definition.sections
      .flatMap((section) => section.fields)
      // A calculated line (a per-person fee) is worked out by the form, so it is neither staff's nor the registrant's to fill in.
      .filter((field) => !isInformationField(field) && field.scope === "ATTENDEE" && field.type !== "CALCULATED")
      .map((field) => ({ field, editable: !excluded.has(field.key) }))
    : [];
  return {
    rosterEnabled,
    sections,
    attendeeFields,
    roster: {
      attendeeLabel: roster.attendeeLabel,
      addButtonLabel: roster.addButtonLabel,
      minAttendees: roster.minAttendees,
      maxAttendees: Math.min(roster.maxAttendees, STAFF_DRAFT_MAX_ATTENDEES),
    },
    excludedKeys: excluded,
  };
}

/** The most people a draft holds, the same as the public form's own limit on a submit. */
export const STAFF_DRAFT_MAX_ATTENDEES = 50;

/** One person on a draft: the client id the public form uses for them, and the answers a draft may keep. */
export type StaffDraftAttendee = { clientId: string; responses: Record<string, unknown> };

/** Keys a draft may hold for this definition. */
export function staffDraftSaveableKeys(definition: RegistrationFormDefinition) {
  const plan = staffDraftPlan(definition);
  return new Set(plan.sections.flatMap((section) => section.fields.filter((entry) => entry.editable).map((entry) => entry.field.key)));
}

/** Attendee keys a draft may hold for this definition (roster forms only). */
export function staffDraftSaveableAttendeeKeys(definition: RegistrationFormDefinition) {
  return new Set(staffDraftPlan(definition).attendeeFields.filter((entry) => entry.editable).map((entry) => entry.field.key));
}

/** Trims answers and drops anything empty, oversized or not in `saveable`. */
function cleanAnswers(kept: Record<string, unknown>, saveable: Set<string>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(kept)) {
    if (!saveable.has(key)) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "" || trimmed.length > MAX_ANSWER_LENGTH) continue;
      result[key] = trimmed;
    } else if (Array.isArray(value)) {
      const items = value.filter((item) => typeof item === "string" && item.length <= MAX_ANSWER_LENGTH);
      if (items.length > 0) result[key] = items.slice(0, 50);
    } else if (typeof value === "boolean") {
      if (value) result[key] = true;
    } else if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, string>).filter(([, item]) => typeof item === "string" && item.trim() !== "" && item.length <= MAX_ANSWER_LENGTH);
      if (entries.length > 0) result[key] = Object.fromEntries(entries);
    }
    if (Object.keys(result).length >= MAX_ANSWER_COUNT) break;
  }
  return result;
}

/**
 * Keeps only the answers a draft may hold. Run on every save, whatever the browser sent: excluded and unknown keys are
 * dropped, an answer whose question is hidden is dropped, and empty and oversized answers are dropped.
 */
export function sanitizeStaffDraftResponses(definition: RegistrationFormDefinition, responses: unknown): Record<string, unknown> {
  // The browser-draft sanitizer already refuses excluded fields, non-plain values and hidden follow-ups.
  const { responses: kept } = sanitizeDraftContent(definition, { responses, attendees: [] });
  return cleanAnswers(kept, staffDraftSaveableKeys(definition));
}

const clientIdPattern = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Keeps only the people a draft may hold (#1510), on a form with an attendee roster; any other form keeps none. Each person
 * keeps the browser-draft attendee allowlist only (names, attendee type, shirt size, paid or limited choices), with hidden
 * follow-ups dropped against the registration answers. A person with no answers left, a repeated or malformed client id,
 * and anyone past the form's limit are dropped.
 */
export function sanitizeStaffDraftAttendees(definition: RegistrationFormDefinition, attendees: unknown, responses: Record<string, unknown> = {}): StaffDraftAttendee[] {
  const plan = staffDraftPlan(definition);
  if (!plan.rosterEnabled || !Array.isArray(attendees)) return [];
  const { attendees: kept } = sanitizeDraftContent(definition, { responses, attendees: attendees.slice(0, STAFF_DRAFT_MAX_ATTENDEES * 2) });
  const saveable = staffDraftSaveableAttendeeKeys(definition);
  const seen = new Set<string>();
  const result: StaffDraftAttendee[] = [];
  for (const attendee of kept) {
    if (!clientIdPattern.test(attendee.clientId) || seen.has(attendee.clientId)) continue;
    const answers = cleanAnswers(attendee.responses, saveable);
    if (Object.keys(answers).length === 0) continue;
    seen.add(attendee.clientId);
    result.push({ clientId: attendee.clientId, responses: answers });
    if (result.length >= plan.roster.maxAttendees) break;
  }
  return result;
}

/** The registrant's name and email as the public submit reads them. Either is null when the draft does not have it yet. */
export function staffDraftContact(definition: RegistrationFormDefinition, responses: Record<string, unknown>) {
  const { identity } = extractPublicContactIdentity(definition, responses);
  if (!identity) return { name: null as string | null, email: null as string | null };
  const email = emailAddressSchema.safeParse(identity.email);
  return {
    name: formatPersonName({ firstName: identity.firstName, lastName: identity.lastName }) || null,
    email: email.success && email.data ? email.data : null,
  };
}

export type StaffDraftCheckLines = {
  /** Questions staff can still answer, by the form's own labels. */
  staffNeeds: string[];
  /** Questions only the registrant can answer, by the form's own labels. */
  registrantFills: string[];
};

function issueLabel(issue: PublicRegistrationIssue, definition: RegistrationFormDefinition, attendeeLabel: string) {
  const field = definition.sections.flatMap((section) => section.fields).find((candidate) => candidate.id === issue.fieldId || candidate.key === issue.key);
  const line = field ? `${field.label}: ${issue.message}` : issue.message;
  return issue.attendeeIndex === null ? line : `${attendeeLabel} ${issue.attendeeIndex + 1}, ${line}`;
}

/**
 * Turns the public submit's problems into two readable lists: what staff can still enter, and what the registrant fills in.
 * A per-person answer a draft may keep (a name, the attendee type) and a problem with the people as a whole (too few) are
 * staff's to enter; every other per-person answer is the registrant's.
 */
export function staffDraftCheckLines(issues: readonly PublicRegistrationIssue[], definition: RegistrationFormDefinition): StaffDraftCheckLines {
  const saveable = staffDraftSaveableKeys(definition);
  const saveableAttendee = staffDraftSaveableAttendeeKeys(definition);
  const attendeeLabel = getAttendeeRosterConfig(definition).attendeeLabel;
  const staffNeeds: string[] = [];
  const registrantFills: string[] = [];
  for (const issue of issues) {
    const line = issueLabel(issue, definition, attendeeLabel);
    const staffCanEnter = issue.attendeeIndex === null
      ? saveable.has(issue.key) || issue.key === "attendees"
      : saveableAttendee.has(issue.key);
    const target = staffCanEnter ? staffNeeds : registrantFills;
    if (!target.includes(line)) target.push(line);
  }
  return { staffNeeds, registrantFills };
}
