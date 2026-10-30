/**
 * The identity disclosure matrix (#128): for every identity field, which
 * audience may read, edit, export and see the audit trail of it, declared as
 * data rather than prose. The identity gates (`duplicate-match-access.ts`,
 * `person-merge-access.ts`) decide through `isDisclosureAllowed`, and the
 * cross-event read audit is written wherever a global-reach read is allowed
 * (`identity-read-audit.ts`), so changing a row here changes behavior and
 * `tests/identity-disclosure-matrix.test.ts` fails until the tests agree.
 *
 * The matrix describes the global identity layer (`Person` and what hangs off
 * it). Event-scoped data such as a registration's contact snapshot keeps its
 * own event permissions (`modules/access/authorization.ts`) and is not
 * governed here. Pure module: no Prisma, no session.
 */

export const IDENTITY_FIELDS = [
  "PERSON_NAME",
  "EMAIL",
  "PHONE",
  "HOUSEHOLD_MEMBERSHIP",
  "ACCOUNT_LINKS",
  "MERGE_HISTORY",
  "MATCH_CANDIDATE_EVIDENCE",
  "EXTERNAL_IDENTITIES",
  "ANONYMIZATION_RECORD",
] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export const DISCLOSURE_AUDIENCES = [
  "SYSTEM_ADMIN",
  "EVENT_STAFF",
  "ATTENDEE_SELF",
  "HOUSEHOLD_MEMBER",
  "ANONYMOUS",
] as const;
export type DisclosureAudience = (typeof DISCLOSURE_AUDIENCES)[number];

export const DISCLOSURE_ACTIONS = ["READ", "EDIT", "EXPORT", "VIEW_AUDIT"] as const;
export type DisclosureAction = (typeof DISCLOSURE_ACTIONS)[number];

/**
 * ALLOWED is a grant the matrix makes by itself (global reach, system
 * administrator only). EVENT_SCOPED is a marker, not a grant: the audience may
 * have this only inside one event, and only when that event's own membership
 * and the person's footprint in the event are proven by the caller
 * (`isEventScopedDisclosureAllowed`). It never evaluates to true on its own.
 */
export type DisclosureDecision = "ALLOWED" | "EVENT_SCOPED" | "DENIED";

/** How sensitive a field is. Informational and tested; it is not a permission by itself. */
export type FieldClassification = "PERSONAL_IDENTIFIER" | "CONTACT_DETAIL" | "RELATIONSHIP" | "DERIVED_JUDGEMENT" | "COMPLIANCE_RECORD";

/**
 * How far an audience's ALLOWED reach. Only GLOBAL may read across event
 * boundaries; an event-staff read is confined to people with a footprint in
 * their own event, and an attendee's to their own records.
 */
export type DisclosureReach = "GLOBAL" | "OWN_EVENT" | "SELF" | "NONE";

export const AUDIENCE_REACH: Readonly<Record<DisclosureAudience, DisclosureReach>> = {
  SYSTEM_ADMIN: "GLOBAL",
  EVENT_STAFF: "OWN_EVENT",
  ATTENDEE_SELF: "SELF",
  HOUSEHOLD_MEMBER: "NONE",
  ANONYMOUS: "NONE",
};

type Row = {
  classification: FieldClassification;
  /** [read, edit, export, viewAudit] per audience, in `DISCLOSURE_AUDIENCES` order. */
  grants: Readonly<Record<DisclosureAudience, readonly [DisclosureDecision, DisclosureDecision, DisclosureDecision, DisclosureDecision]>>;
};

const A = "ALLOWED" as const;
const D = "DENIED" as const;
const S = "EVENT_SCOPED" as const;
const NONE = [D, D, D, D] as const;

/**
 * Notes on the declared values (today's behavior, not new policy):
 * - A household member has no standing over another member's identity record;
 *   household membership is a convenience grouping, not authority (#43).
 * - EVENT_SCOPED cells are markers for rosters that event permissions govern:
 *   they grant nothing here and need explicit proof (see `isEventScopedDisclosureAllowed`).
 * - An attendee never reaches `Person` at all, so every attendee cell is denied;
 *   an attendee reaches their own registration by verified email, never by
 *   Person, household or account link (ADR 0003), so links are not theirs to read.
 * - Event staff see a person's name and contact details only through that
 *   event's own registrations (OWN_EVENT reach); they cannot edit the global
 *   Person, see merge history, match evidence, links or external identities,
 *   or read the identity audit trail.
 * - Merging, unmerging, dismissing candidates and anonymizing are system
 *   administrator actions (EDIT on the matching field). No identity export
 *   exists beyond event rosters, so EXPORT is denied except for name and
 *   contact details via an event's own roster.
 */
export const DISCLOSURE_MATRIX: Readonly<Record<IdentityField, Row>> = {
  PERSON_NAME: {
    classification: "PERSONAL_IDENTIFIER",
    grants: {
      SYSTEM_ADMIN: [A, A, A, A],
      EVENT_STAFF: [S, D, S, D],
      ATTENDEE_SELF: NONE,
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
  EMAIL: {
    classification: "CONTACT_DETAIL",
    grants: {
      SYSTEM_ADMIN: [A, A, A, A],
      EVENT_STAFF: [S, D, S, D],
      ATTENDEE_SELF: NONE,
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
  PHONE: {
    classification: "CONTACT_DETAIL",
    grants: {
      SYSTEM_ADMIN: [A, A, A, A],
      EVENT_STAFF: [S, D, S, D],
      ATTENDEE_SELF: NONE,
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
  HOUSEHOLD_MEMBERSHIP: {
    classification: "RELATIONSHIP",
    grants: {
      SYSTEM_ADMIN: [A, A, D, A],
      EVENT_STAFF: NONE,
      ATTENDEE_SELF: NONE,
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
  ACCOUNT_LINKS: {
    classification: "RELATIONSHIP",
    grants: {
      SYSTEM_ADMIN: [A, A, D, A],
      EVENT_STAFF: NONE,
      ATTENDEE_SELF: NONE,
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
  MERGE_HISTORY: {
    classification: "DERIVED_JUDGEMENT",
    grants: {
      SYSTEM_ADMIN: [A, A, D, A],
      EVENT_STAFF: NONE,
      ATTENDEE_SELF: NONE,
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
  MATCH_CANDIDATE_EVIDENCE: {
    classification: "DERIVED_JUDGEMENT",
    grants: {
      SYSTEM_ADMIN: [A, A, D, A],
      EVENT_STAFF: NONE,
      ATTENDEE_SELF: NONE,
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
  EXTERNAL_IDENTITIES: {
    classification: "PERSONAL_IDENTIFIER",
    grants: {
      SYSTEM_ADMIN: [A, A, D, A],
      EVENT_STAFF: NONE,
      ATTENDEE_SELF: NONE,
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
  ANONYMIZATION_RECORD: {
    classification: "COMPLIANCE_RECORD",
    grants: {
      SYSTEM_ADMIN: [A, A, D, A],
      EVENT_STAFF: NONE,
      ATTENDEE_SELF: NONE,
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
};

export function disclosureDecision(field: IdentityField, audience: DisclosureAudience, action: DisclosureAction): DisclosureDecision {
  return DISCLOSURE_MATRIX[field].grants[audience][DISCLOSURE_ACTIONS.indexOf(action)] ?? "DENIED";
}

/**
 * Deny by default. True only when the matrix itself grants the action
 * (decision ALLOWED), which only an audience with GLOBAL reach can hold. An
 * EVENT_SCOPED cell is never true here, so an event-staff or attendee
 * audience can never pass a gate written with this function; unknown fields,
 * audiences and actions are denied.
 */
export function isDisclosureAllowed(field: IdentityField, audience: DisclosureAudience, action: DisclosureAction): boolean {
  if (!(field in DISCLOSURE_MATRIX) || !DISCLOSURE_AUDIENCES.includes(audience) || !DISCLOSURE_ACTIONS.includes(action)) return false;
  return AUDIENCE_REACH[audience] === "GLOBAL" && disclosureDecision(field, audience, action) === "ALLOWED";
}

/** What a caller must have established before an EVENT_SCOPED cell can apply. */
export type EventScopeProof = {
  eventId: string;
  /** The signed-in user holds an ACTIVE membership (and the needed permission) on `eventId`. */
  hasEventPermission: boolean;
  /** The person has a footprint in `eventId` (`personBelongsToEvent`). */
  personInEvent: boolean;
};

/**
 * An EVENT_SCOPED cell applies only with explicit proof for one event. Without
 * a non-empty event id and both proofs it is false, so it can never act as a
 * global lookup. No caller uses it today; event rosters keep their own
 * permission checks.
 */
export function isEventScopedDisclosureAllowed(field: IdentityField, audience: DisclosureAudience, action: DisclosureAction, proof: EventScopeProof): boolean {
  if (!(field in DISCLOSURE_MATRIX) || !DISCLOSURE_AUDIENCES.includes(audience) || !DISCLOSURE_ACTIONS.includes(action)) return false;
  if (!proof || !proof.eventId || proof.hasEventPermission !== true || proof.personInEvent !== true) return false;
  return disclosureDecision(field, audience, action) === "EVENT_SCOPED";
}

/**
 * A signed-in staff account's identity audience. Only the cross-event
 * `globalRole` makes a system administrator; every other staff account is
 * event staff whatever permissions it holds on an event, because no event
 * permission is an identity permission.
 */
export function staffIdentityAudience(user: { globalRole?: "SYSTEM_ADMIN" | null }): DisclosureAudience {
  return user.globalRole === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN" : "EVENT_STAFF";
}

/** Which identity field each `Person` column belongs to, so a projection can be decided by the matrix. */
export const PERSON_COLUMN_FIELDS = {
  firstName: "PERSON_NAME",
  lastName: "PERSON_NAME",
  normalizedEmail: "EMAIL",
  phone: "PHONE",
} as const satisfies Record<string, IdentityField>;
export type PersonColumn = keyof typeof PERSON_COLUMN_FIELDS;

/**
 * The Prisma `select` for a person read: `id` plus the requested columns, each
 * decided by the matrix for the audience. It throws if the audience may not
 * read a requested column, so a denied column can never silently go missing
 * from a typed result (or be fetched).
 */
export function personColumnSelect<C extends PersonColumn>(audience: DisclosureAudience, columns: readonly C[]): { id: true } & Record<C, true> {
  const select: Record<string, true> = { id: true };
  for (const column of columns) {
    if (!isDisclosureAllowed(PERSON_COLUMN_FIELDS[column], audience, "READ")) {
      throw new Error(`Audience ${audience} may not read ${column}.`);
    }
    select[column] = true;
  }
  return select as { id: true } & Record<C, true>;
}
