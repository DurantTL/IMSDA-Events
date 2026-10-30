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

export type DisclosureDecision = "ALLOWED" | "DENIED";

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
const NONE = [D, D, D, D] as const;

/**
 * Notes on the declared values (today's behavior, not new policy):
 * - A household member has no standing over another member's identity record;
 *   household membership is a convenience grouping, not authority (#43).
 * - An attendee reaches their own registration by verified email, never by
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
      EVENT_STAFF: [A, D, A, D],
      ATTENDEE_SELF: [A, D, D, D],
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
  EMAIL: {
    classification: "CONTACT_DETAIL",
    grants: {
      SYSTEM_ADMIN: [A, A, A, A],
      EVENT_STAFF: [A, D, A, D],
      ATTENDEE_SELF: [A, D, D, D],
      HOUSEHOLD_MEMBER: NONE,
      ANONYMOUS: NONE,
    },
  },
  PHONE: {
    classification: "CONTACT_DETAIL",
    grants: {
      SYSTEM_ADMIN: [A, A, A, A],
      EVENT_STAFF: [A, D, A, D],
      ATTENDEE_SELF: [A, D, D, D],
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
 * Whether the audience may take the action. `reach: "GLOBAL"` asks about a
 * cross-event read (a global search, the review queue, the merges list); only
 * an audience whose declared reach is GLOBAL can pass it, however the cell
 * reads. Unknown fields, audiences and actions are denied.
 */
export function isDisclosureAllowed(
  field: IdentityField,
  audience: DisclosureAudience,
  action: DisclosureAction,
  options: { reach?: "GLOBAL" | "SCOPED" } = {},
): boolean {
  if (!(field in DISCLOSURE_MATRIX) || !DISCLOSURE_AUDIENCES.includes(audience) || !DISCLOSURE_ACTIONS.includes(action)) return false;
  if (options.reach === "GLOBAL" && AUDIENCE_REACH[audience] !== "GLOBAL") return false;
  return disclosureDecision(field, audience, action) === "ALLOWED";
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
 * The Prisma `select` for a global-reach person read: `id` plus only the
 * columns whose field the audience may read. A column the matrix denies is
 * left out of the query, so it can never reach a response.
 */
export function personColumnSelect(audience: DisclosureAudience, columns: readonly PersonColumn[]): { id: true } & Partial<Record<PersonColumn, true>> {
  const select: { id: true } & Partial<Record<PersonColumn, true>> = { id: true };
  for (const column of columns) {
    if (isDisclosureAllowed(PERSON_COLUMN_FIELDS[column], audience, "READ", { reach: "GLOBAL" })) select[column] = true;
  }
  return select;
}
