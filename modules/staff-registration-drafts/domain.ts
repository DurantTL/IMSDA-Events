import { emailAddressSchema } from "@/lib/field-validation";
import { getAttendeeRosterConfig, isInformationField, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { draftExcludedKeys, sanitizeDraftContent } from "@/modules/forms/public-draft";
import { extractPublicContactIdentity, type PublicRegistrationIssue } from "@/modules/forms/public-domain";

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

export const STAFF_DRAFT_STATUS_LABELS: Record<StaffDraftStatus, string> = {
  OPEN: "Being entered",
  HANDED_OFF: "Sent to registrant",
  SUBMITTED: "Submitted by registrant",
  DISCARDED: "Discarded",
};

/** The private link works for 14 days, the same window as a browser draft. */
export const STAFF_DRAFT_LINK_LIFETIME_DAYS = 14;
const dayMilliseconds = 24 * 60 * 60 * 1000;

export function staffDraftLinkExpiry(now: Date) {
  return new Date(now.getTime() + STAFF_DRAFT_LINK_LIFETIME_DAYS * dayMilliseconds);
}

export const STAFF_DRAFT_REGISTRANT_FILLS_IN = "The registrant fills this in.";
export const STAFF_DRAFT_ROSTER_NOTE =
  "This form asks about each attendee. Staff enter the registration answers only; the registrant adds the people when they finish.";
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
 * What staff may type and what they may not, for the form's published definition. Attendee-roster answers are not part
 * of a draft: a form with a roster has its registration-scope questions only, and the registrant adds the people.
 */
export function staffDraftPlan(definition: RegistrationFormDefinition) {
  const rosterEnabled = getAttendeeRosterConfig(definition).enabled;
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
  return { rosterEnabled, sections, excludedKeys: excluded };
}

/** Keys a draft may hold for this definition. */
export function staffDraftSaveableKeys(definition: RegistrationFormDefinition) {
  const plan = staffDraftPlan(definition);
  return new Set(plan.sections.flatMap((section) => section.fields.filter((entry) => entry.editable).map((entry) => entry.field.key)));
}

/**
 * Keeps only the answers a draft may hold. Run on every save, whatever the browser sent: excluded and unknown keys are
 * dropped, an answer whose question is hidden is dropped, and empty and oversized answers are dropped.
 */
export function sanitizeStaffDraftResponses(definition: RegistrationFormDefinition, responses: unknown): Record<string, unknown> {
  const saveable = staffDraftSaveableKeys(definition);
  // The browser-draft sanitizer already refuses excluded fields, non-plain values and hidden follow-ups.
  const { responses: kept } = sanitizeDraftContent(definition, { responses, attendees: [] });
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

/** The registrant's name and email as the public submit reads them. Either is null when the draft does not have it yet. */
export function staffDraftContact(definition: RegistrationFormDefinition, responses: Record<string, unknown>) {
  const { identity } = extractPublicContactIdentity(definition, responses);
  if (!identity) return { name: null as string | null, email: null as string | null };
  const email = emailAddressSchema.safeParse(identity.email);
  return {
    name: `${identity.firstName} ${identity.lastName}`.trim() || null,
    email: email.success && email.data ? email.data : null,
  };
}

export type StaffDraftCheckLines = {
  /** Questions staff can still answer, by the form's own labels. */
  staffNeeds: string[];
  /** Questions only the registrant can answer, by the form's own labels. */
  registrantFills: string[];
};

function issueLabel(issue: PublicRegistrationIssue, definition: RegistrationFormDefinition) {
  const field = definition.sections.flatMap((section) => section.fields).find((candidate) => candidate.id === issue.fieldId || candidate.key === issue.key);
  return field ? `${field.label}: ${issue.message}` : issue.message;
}

/** Turns the public submit's problems into two readable lists: what staff can still enter, and what the registrant fills in. */
export function staffDraftCheckLines(issues: readonly PublicRegistrationIssue[], definition: RegistrationFormDefinition): StaffDraftCheckLines {
  const saveable = staffDraftSaveableKeys(definition);
  const staffNeeds: string[] = [];
  const registrantFills: string[] = [];
  for (const issue of issues) {
    const line = issueLabel(issue, definition);
    const target = issue.attendeeIndex === null && saveable.has(issue.key) ? staffNeeds : registrantFills;
    if (!target.includes(line)) target.push(line);
  }
  return { staffNeeds, registrantFills };
}
