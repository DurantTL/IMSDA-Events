import { createHash } from "node:crypto";
import {
  isFieldVisible,
  type RegistrationFormDefinition,
  type RegistrationFormField,
} from "@/modules/forms/definition";
import type { MinorStatus } from "@/modules/guardian-authority/domain";

/**
 * Acknowledgment evidence (#150): the pure rules, free of the database so they are unit-tested on their own.
 *
 * An ACKNOWLEDGMENT field records the act, not a signature: the submission audit already says who submitted and
 * when, so no typed signature or signature date exists here. What is recorded is the exact text shown or the
 * published policy version referenced, who acknowledged and for whom, the channel, and approved request metadata.
 */

export const acknowledgmentChannels = ["ONLINE", "STAFF_ENTERED", "PAPER"] as const;
export type AcknowledgmentChannel = (typeof acknowledgmentChannels)[number];

export const channelLabels: Record<AcknowledgmentChannel, string> = {
  ONLINE: "Online",
  STAFF_ENTERED: "Entered by staff",
  PAPER: "Paper form",
};

/**
 * The only request metadata that may be stored with evidence. A user agent is kept only as a one-way hash, and there
 * is deliberately no IP address: nobody has approved recording one. A database check constraint enforces the same list,
 * so adding a key takes a migration and a decision, not a code change alone.
 */
export const APPROVED_REQUEST_METADATA_KEYS = ["userAgentHash", "formVersionId", "submissionKey"] as const;
const METADATA_VALUE_MAX = 200;

/** Keeps only approved keys with short string values; anything else (headers, addresses, bodies) is dropped. */
export function approvedRequestMetadata(input: Record<string, unknown> | null | undefined): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of APPROVED_REQUEST_METADATA_KEYS) {
    const value = input?.[key];
    if (typeof value === "string" && value.length > 0) kept[key] = value.slice(0, METADATA_VALUE_MAX);
  }
  return kept;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Every acknowledgment field of a definition, in form order. */
export function acknowledgmentFields(definition: RegistrationFormDefinition): RegistrationFormField[] {
  return definition.sections.flatMap((section) => section.fields).filter((field) => field.type === "ACKNOWLEDGMENT");
}

// ---------------------------------------------------------------------------------------------
// What was shown
// ---------------------------------------------------------------------------------------------

export type ShownContent =
  | { source: "TEXT"; shownText: string; policyVersionId: null; contentHash: string; contentRef: string }
  | { source: "POLICY_VERSION"; shownText: null; policyVersionId: string; contentHash: string; contentRef: string };

/** The exact wording a TEXT acknowledgment shows. The form version is immutable once published, so this is what was seen. */
export function textContent(text: string): ShownContent {
  const contentHash = sha256(text);
  return { source: "TEXT", shownText: text, policyVersionId: null, contentHash, contentRef: `text:${contentHash}` };
}

/** A published policy version, by id; the version's own content hash identifies what it said. */
export function policyContent(version: { id: string; contentHash: string | null }): ShownContent {
  return {
    source: "POLICY_VERSION",
    shownText: null,
    policyVersionId: version.id,
    contentHash: version.contentHash ?? "",
    contentRef: `policy:${version.id}`,
  };
}

/** What a public form or preview renders for one acknowledgment: never evidence, only the wording. */
export type AcknowledgmentDisplay = {
  source: "TEXT" | "POLICY_VERSION";
  title: string | null;
  text: string;
  versionNumber: number | null;
};

// ---------------------------------------------------------------------------------------------
// Acting for another person
// ---------------------------------------------------------------------------------------------

export type ActingDecision =
  | { allowed: true; actingForAnother: boolean; guardianAuthorityId: string | null }
  | { allowed: false; code: "ACTING_FOR_MINOR_NOT_AUTHORIZED" | "ACTING_FOR_ANOTHER_NOT_AUTHORIZED"; message: string };

/**
 * Who may acknowledge for whom. The one rule: acting for another person needs a recorded declaration (#131).
 *
 * - A registration-level acknowledgment is the registrant's own.
 * - An adult (or a person whose age is unknown) acknowledges for themselves. Nobody acknowledges for another adult:
 *   nothing records that authority, and household membership or being the account holder is not authority.
 * - A minor is acknowledged for only by the responsible adult declared for them (an ACTIVE, live #131 declaration).
 *   The minor's own tick never counts, and neither does a parent who was not declared.
 *
 * `authority` is the minor's declared responsible adult, read by the caller; this function never looks for anyone else.
 */
export function decideActing(input: {
  subject: { personId: string | null; status: MinorStatus["status"] };
  actedByPersonId: string;
  authority: { id: string; adultPersonId: string } | null;
}): ActingDecision {
  const { subject, actedByPersonId, authority } = input;
  if (subject.personId === null) return { allowed: true, actingForAnother: false, guardianAuthorityId: null };
  if (subject.status === "MINOR") {
    if (authority && authority.adultPersonId === actedByPersonId && actedByPersonId !== subject.personId) {
      return { allowed: true, actingForAnother: true, guardianAuthorityId: authority.id };
    }
    return {
      allowed: false,
      code: "ACTING_FOR_MINOR_NOT_AUTHORIZED",
      message: "A minor's acknowledgment must be given by the responsible adult declared for them on this registration.",
    };
  }
  if (subject.personId === actedByPersonId) return { allowed: true, actingForAnother: false, guardianAuthorityId: null };
  return {
    allowed: false,
    code: "ACTING_FOR_ANOTHER_NOT_AUTHORIZED",
    message: "Each adult acknowledges for themselves. Nobody can acknowledge for another adult.",
  };
}

// ---------------------------------------------------------------------------------------------
// Which acknowledgments a submission carries
// ---------------------------------------------------------------------------------------------

export type PlannedAcknowledgment = {
  field: RegistrationFormField;
  /** Null for a registration-level acknowledgment; otherwise the attendee's client id. */
  attendeeClientId: string | null;
};

/**
 * The acknowledgments a validated submission actually gives: a visible field answered `true`. A field hidden by its
 * condition, or left unticked, gives none, so a conditional acknowledgment that does not apply records nothing. Repeating
 * attendee sections give one per attendee, evaluated against the shared registration answers plus that attendee's own.
 */
export function planAcknowledgments(
  definition: RegistrationFormDefinition,
  input: {
    registrationResponses: Record<string, unknown>;
    attendees: ReadonlyArray<{ clientId: string; responses: Record<string, unknown> }>;
  },
): PlannedAcknowledgment[] {
  const planned: PlannedAcknowledgment[] = [];
  for (const field of acknowledgmentFields(definition)) {
    if (field.scope === "REGISTRATION") {
      if (isFieldVisible(field, input.registrationResponses) && input.registrationResponses[field.key] === true) {
        planned.push({ field, attendeeClientId: null });
      }
      continue;
    }
    for (const attendee of input.attendees) {
      const merged = { ...input.registrationResponses, ...attendee.responses };
      if (isFieldVisible(field, merged) && attendee.responses[field.key] === true) {
        planned.push({ field, attendeeClientId: attendee.clientId });
      }
    }
  }
  return planned;
}

// ---------------------------------------------------------------------------------------------
// Retries
// ---------------------------------------------------------------------------------------------

export type EvidenceIdentity = {
  eventId: string;
  registrationId: string;
  registrationAttendeeId: string | null;
  fieldKey: string;
  actedByPersonId: string;
  channel: AcknowledgmentChannel;
  contentRef: string;
};

/**
 * What a request means, for telling a retry from a different request that reuses a key. The moment is left out on
 * purpose: a retry arrives later than the first attempt and is still the same request.
 */
export function evidenceRequestHash(identity: EvidenceIdentity) {
  return sha256(JSON.stringify([
    identity.eventId,
    identity.registrationId,
    identity.registrationAttendeeId,
    identity.fieldKey,
    identity.actedByPersonId,
    identity.channel,
    identity.contentRef,
  ]));
}

/** The key a registration form submission gives each acknowledgment it records, stable across a retried submission. */
export function submissionEvidenceKey(submissionKey: string, fieldId: string, attendeeClientId: string | null) {
  return `submission:${submissionKey}:${fieldId}:${attendeeClientId ?? "registration"}`;
}

/** The key a staff or paper entry gives its acknowledgment, from the request id the caller sends and keeps on retry. */
export function staffEvidenceKey(clientRequestId: string) {
  return `staff:${clientRequestId}`;
}

// ---------------------------------------------------------------------------------------------
// Historical status
// ---------------------------------------------------------------------------------------------

export const acknowledgmentStatuses = [
  "NOT_ACKNOWLEDGED",
  "ACKNOWLEDGED",
  "ACKNOWLEDGED_EARLIER_VERSION",
  "REACKNOWLEDGMENT_REQUIRED",
] as const;
export type AcknowledgmentStatusCode = (typeof acknowledgmentStatuses)[number];

export const statusLabels: Record<AcknowledgmentStatusCode, string> = {
  NOT_ACKNOWLEDGED: "Not acknowledged",
  ACKNOWLEDGED: "Acknowledged",
  ACKNOWLEDGED_EARLIER_VERSION: "Acknowledged an earlier version",
  REACKNOWLEDGMENT_REQUIRED: "Needs to acknowledge the updated policy",
};

/**
 * Where a person stands at a moment, from their latest evidence at or before it.
 *
 * - No evidence yet: not acknowledged.
 * - Text, or the policy version still in force (or none in force): acknowledged.
 * - A later version took effect: if any version after the one they saw, up to the one in force, was marked a material
 *   change by a human, they must acknowledge again; otherwise they acknowledged an earlier version that still stands.
 *
 * Judgment about materiality is never inferred here: the flag is the publisher's, recorded at publish time (#129).
 */
export function resolveAcknowledgmentStatus(input: {
  evidence: { source: "TEXT" | "POLICY_VERSION" } | null;
  /** Only for a policy-version acknowledgment. */
  policy?: {
    evidenceVersionNumber: number;
    /** The version in force at the moment asked about; null when none is. */
    effective: { versionNumber: number } | null;
    /** Whether any version after the evidence's, up to the one in force, is a material change. */
    laterVersionIsMaterial: boolean;
  };
}): AcknowledgmentStatusCode {
  if (!input.evidence) return "NOT_ACKNOWLEDGED";
  if (input.evidence.source === "TEXT" || !input.policy || !input.policy.effective) return "ACKNOWLEDGED";
  if (input.policy.effective.versionNumber <= input.policy.evidenceVersionNumber) return "ACKNOWLEDGED";
  return input.policy.laterVersionIsMaterial ? "REACKNOWLEDGMENT_REQUIRED" : "ACKNOWLEDGED_EARLIER_VERSION";
}

// ---------------------------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------------------------

/**
 * An amendment can neither give nor change an acknowledgment: the stored `true` is only ever written next to its
 * evidence, so an amendment keeps each acknowledgment answer exactly as stored (and gives a new attendee none).
 * Whoever needs an acknowledgment for someone added later records it through the evidence path, where the person who
 * acknowledged, the channel and the authority for a minor are all checked. Returns the input with those answers held,
 * and the keys that must not be required while the amendment is checked.
 */
export function holdAcknowledgmentAnswers<
  Input extends { responses: Record<string, unknown>; attendees: ReadonlyArray<{ attendeeId?: string | null; responses: Record<string, unknown> }> },
>(
  definition: RegistrationFormDefinition,
  input: Input,
  stored: { registration: Record<string, unknown>; attendee: (attendeeId: string) => Record<string, unknown> | null },
): { input: Input; keys: string[] } {
  const fields = acknowledgmentFields(definition);
  if (fields.length === 0) return { input, keys: [] };
  const hold = (answers: Record<string, unknown>, original: Record<string, unknown> | null, scope: "REGISTRATION" | "ATTENDEE") => {
    const next = { ...answers };
    for (const field of fields) {
      if (field.scope !== scope) continue;
      if (original && Object.hasOwn(original, field.key)) next[field.key] = original[field.key];
      else delete next[field.key];
    }
    return next;
  };
  return {
    input: {
      ...input,
      responses: hold(input.responses, stored.registration, "REGISTRATION"),
      attendees: input.attendees.map((attendee) => ({
        ...attendee,
        responses: hold(attendee.responses, attendee.attendeeId ? stored.attendee(attendee.attendeeId) : null, "ATTENDEE"),
      })),
    },
    keys: fields.map((field) => field.key),
  };
}
