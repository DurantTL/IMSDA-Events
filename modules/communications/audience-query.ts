import { createHash } from "node:crypto";
import { z } from "zod";
import type { EventPermission } from "@/modules/access/permissions";

/**
 * The query contract of the reviewed event audience builder (#176), the pure half.
 *
 * A query says who an event message would reach. It is preview-only data: nothing here sends, schedules or queues a
 * message, and the query holds no address, name or note, only closed vocabularies and configured tag identifiers.
 *
 * Every filter is a named dimension with the permission and the event domain it needs. A dimension a user may not
 * use, or whose domain the event does not have, is refused with one generic answer that names no value and no count,
 * so a refusal teaches nothing about what the event holds. The query is normalized (sorted, de-duplicated, defaults
 * filled in) before it is hashed, so equal questions always produce equal hashes and fingerprints.
 */

/** Bump when the meaning of a query, or how an audience is evaluated from it, changes. Stored on every snapshot. */
export const AUDIENCE_QUERY_VERSION = "audience-query/1";

export const AUDIENCE_ROLES = [
  "REGISTRATION_CONTACT",
  "ATTENDEE",
  "GROUP_LEADER",
  "ORGANIZATION_CONTACT",
] as const;
export type AudienceRole = (typeof AUDIENCE_ROLES)[number];

export const AUDIENCE_ROLE_LABELS: Record<AudienceRole, string> = {
  REGISTRATION_CONTACT: "Registration contact",
  ATTENDEE: "Attendee",
  GROUP_LEADER: "Group leader",
  ORGANIZATION_CONTACT: "Approved organization contact",
};

/** Deterministic order a recipient's display name and primary role are chosen in. */
export const AUDIENCE_ROLE_PRIORITY: Record<AudienceRole, number> = {
  REGISTRATION_CONTACT: 0,
  GROUP_LEADER: 1,
  ORGANIZATION_CONTACT: 2,
  ATTENDEE: 3,
};

/** DRAFT is never an audience: a draft is not yet a registrant. */
export const AUDIENCE_LIFECYCLES = ["SUBMITTED", "CONFIRMED", "WAITLISTED", "CANCELLED"] as const;
export type AudienceLifecycle = (typeof AUDIENCE_LIFECYCLES)[number];
export const DEFAULT_AUDIENCE_LIFECYCLES: readonly AudienceLifecycle[] = ["SUBMITTED", "CONFIRMED"];

export const AUDIENCE_BALANCE_STATES = ["BALANCE_DUE", "PAID_IN_FULL", "NO_CHARGE", "ORGANIZATION_BILLED"] as const;
export type AudienceBalanceState = (typeof AUDIENCE_BALANCE_STATES)[number];

export const AUDIENCE_CHECK_IN_STATES = ["CHECKED_IN", "PARTIALLY_CHECKED_IN", "NOT_CHECKED_IN"] as const;
export type AudienceCheckInState = (typeof AUDIENCE_CHECK_IN_STATES)[number];

/**
 * Approved normalized actionable statuses only. A readiness value says that something needs doing, derived from
 * whether data exists, never from what the data says. Medical, screening, consent evidence and notes can never be
 * a value here.
 */
export const AUDIENCE_READINESS_STATES = ["ATTENDEE_RESPONSES_INCOMPLETE"] as const;
export type AudienceReadinessState = (typeof AUDIENCE_READINESS_STATES)[number];

/** What kind of message the audience is for. Only announcements honour an announcement opt-out (#838). */
export const AUDIENCE_MESSAGE_KINDS = ["ANNOUNCEMENT", "OPERATIONAL"] as const;
export type AudienceMessageKind = (typeof AUDIENCE_MESSAGE_KINDS)[number];

export const AUDIENCE_DOMAINS = ["REGISTRATION", "GROUPS", "ORGANIZATIONS"] as const;
export type AudienceDomain = (typeof AUDIENCE_DOMAINS)[number];

export const AUDIENCE_DIMENSIONS = [
  "roles",
  "lifecycles",
  "attendeeTypes",
  "tagIds",
  "balanceStates",
  "checkInStates",
  "readinessStates",
] as const;
export type AudienceDimension = (typeof AUDIENCE_DIMENSIONS)[number];

type DimensionRule = {
  label: string;
  domain: AudienceDomain;
  /** Held in addition to MANAGE_COMMUNICATIONS, which the whole builder needs. null means nothing more. */
  permission: EventPermission | null;
};

/**
 * Who may use which dimension. Tags are read through VIEW_SENSITIVE_DATA everywhere else (registration tag reads), so
 * the builder does not become a way round that. Check-in state needs the check-in permission, and readiness needs
 * registration management, for the same reason.
 */
export const AUDIENCE_DIMENSION_RULES: Record<AudienceDimension, DimensionRule> = {
  roles: { label: "Recipient roles", domain: "REGISTRATION", permission: null },
  lifecycles: { label: "Registration lifecycle", domain: "REGISTRATION", permission: null },
  attendeeTypes: { label: "Attendee type", domain: "REGISTRATION", permission: null },
  tagIds: { label: "Tags", domain: "REGISTRATION", permission: "VIEW_SENSITIVE_DATA" },
  balanceStates: { label: "Balance state", domain: "REGISTRATION", permission: null },
  checkInStates: { label: "Check-in status", domain: "REGISTRATION", permission: "MANAGE_CHECK_IN" },
  readinessStates: { label: "Readiness", domain: "REGISTRATION", permission: "MANAGE_REGISTRATION" },
};

/** A role is itself gated by its domain: group and organization contacts exist only on events that have them. */
export const AUDIENCE_ROLE_DOMAINS: Record<AudienceRole, AudienceDomain> = {
  REGISTRATION_CONTACT: "REGISTRATION",
  ATTENDEE: "REGISTRATION",
  GROUP_LEADER: "GROUPS",
  ORGANIZATION_CONTACT: "ORGANIZATIONS",
};

const identifier = z.string().trim().min(1).max(64);
const attendeeTypeValue = z.string().trim().min(1).max(64);

/** Strict: an unknown key (a note, medical or consent field, say) is a validation error, not a quiet no-op. */
export const audienceQuerySchema = z.strictObject({
  messageKind: z.enum(AUDIENCE_MESSAGE_KINDS).default("ANNOUNCEMENT"),
  roles: z.array(z.enum(AUDIENCE_ROLES)).max(AUDIENCE_ROLES.length).default(["REGISTRATION_CONTACT"]),
  lifecycles: z.array(z.enum(AUDIENCE_LIFECYCLES)).max(AUDIENCE_LIFECYCLES.length).optional(),
  attendeeTypes: z.array(attendeeTypeValue).max(25).optional(),
  tagIds: z.array(identifier).max(25).optional(),
  balanceStates: z.array(z.enum(AUDIENCE_BALANCE_STATES)).max(AUDIENCE_BALANCE_STATES.length).optional(),
  checkInStates: z.array(z.enum(AUDIENCE_CHECK_IN_STATES)).max(AUDIENCE_CHECK_IN_STATES.length).optional(),
  readinessStates: z.array(z.enum(AUDIENCE_READINESS_STATES)).max(AUDIENCE_READINESS_STATES.length).optional(),
});

export type AudienceQueryInput = z.input<typeof audienceQuerySchema>;

export type NormalizedAudienceQuery = {
  messageKind: AudienceMessageKind;
  roles: AudienceRole[];
  lifecycles: AudienceLifecycle[];
  attendeeTypes: string[];
  tagIds: string[];
  balanceStates: AudienceBalanceState[];
  checkInStates: AudienceCheckInState[];
  readinessStates: AudienceReadinessState[];
};

function sortedUnique<T extends string>(values: readonly T[] | undefined): T[] {
  return [...new Set(values ?? [])].sort();
}

/** An empty list means "this dimension is not filtered", for every dimension but roles and lifecycles (defaulted). */
export function normalizeAudienceQuery(input: unknown): NormalizedAudienceQuery {
  const parsed = audienceQuerySchema.parse(input);
  const roles = sortedUnique(parsed.roles);
  const lifecycles = sortedUnique(parsed.lifecycles ?? DEFAULT_AUDIENCE_LIFECYCLES);
  return {
    messageKind: parsed.messageKind,
    roles: roles.length ? roles : ["REGISTRATION_CONTACT"],
    lifecycles: lifecycles.length ? lifecycles : [...DEFAULT_AUDIENCE_LIFECYCLES],
    attendeeTypes: sortedUnique(parsed.attendeeTypes),
    tagIds: sortedUnique(parsed.tagIds),
    balanceStates: sortedUnique(parsed.balanceStates),
    checkInStates: sortedUnique(parsed.checkInStates),
    readinessStates: sortedUnique(parsed.readinessStates),
  };
}

export function audienceQueryHash(query: NormalizedAudienceQuery) {
  return createHash("sha256").update(JSON.stringify({ version: AUDIENCE_QUERY_VERSION, query })).digest("hex");
}

export type AudienceCapabilities = {
  /** The caller's effective event permissions. */
  permissions: ReadonlySet<string>;
  /** Domains this event actually has. REGISTRATION is always present. */
  domains: ReadonlySet<AudienceDomain>;
};

export function dimensionAvailable(dimension: AudienceDimension, capabilities: AudienceCapabilities) {
  const rule = AUDIENCE_DIMENSION_RULES[dimension];
  if (!capabilities.domains.has(rule.domain)) return false;
  return rule.permission === null || capabilities.permissions.has(rule.permission);
}

export function roleAvailable(role: AudienceRole, capabilities: AudienceCapabilities) {
  return capabilities.domains.has(AUDIENCE_ROLE_DOMAINS[role]);
}

/** Which dimensions a normalized query actually narrows on (a non-empty list; roles and lifecycles always count). */
export function dimensionsInUse(query: NormalizedAudienceQuery): AudienceDimension[] {
  return AUDIENCE_DIMENSIONS.filter((dimension) => (
    dimension === "roles" || dimension === "lifecycles" || query[dimension].length > 0
  ));
}

export class AudienceFilterNotAvailableError extends Error {
  readonly code = "AUDIENCE_FILTER_NOT_AVAILABLE";
  constructor() {
    // One fixed message: it never names the dimension, a value, or a count.
    super("One of the audience filters is not available to you for this event.");
    this.name = "AudienceFilterNotAvailableError";
  }
}

/**
 * Refuses any filter the caller may not use. The refusal is identical whether the filter is forbidden by permission,
 * belongs to a domain the event lacks, or names a value that does not exist, so it reveals nothing about the event.
 */
export function assertQueryAvailable(query: NormalizedAudienceQuery, capabilities: AudienceCapabilities) {
  for (const dimension of dimensionsInUse(query)) {
    if (!dimensionAvailable(dimension, capabilities)) throw new AudienceFilterNotAvailableError();
  }
  for (const role of query.roles) {
    if (!roleAvailable(role, capabilities)) throw new AudienceFilterNotAvailableError();
  }
}

export type AvailableAudienceFilter = {
  dimension: AudienceDimension;
  label: string;
  values: Array<{ value: string; label: string }>;
};

const LIFECYCLE_LABELS: Record<AudienceLifecycle, string> = {
  SUBMITTED: "Submitted",
  CONFIRMED: "Confirmed",
  WAITLISTED: "Waitlisted",
  CANCELLED: "Cancelled",
};
const BALANCE_LABELS: Record<AudienceBalanceState, string> = {
  BALANCE_DUE: "Balance due",
  PAID_IN_FULL: "Paid in full",
  NO_CHARGE: "No charge",
  ORGANIZATION_BILLED: "Billed to the organization",
};
const CHECK_IN_LABELS: Record<AudienceCheckInState, string> = {
  CHECKED_IN: "Everyone checked in",
  PARTIALLY_CHECKED_IN: "Some checked in",
  NOT_CHECKED_IN: "No one checked in",
};
const READINESS_LABELS: Record<AudienceReadinessState, string> = {
  ATTENDEE_RESPONSES_INCOMPLETE: "Attendee responses incomplete",
};

/**
 * The filters this caller may compose, with their values. A dimension that is unavailable is absent, not empty: the
 * list never says that something exists behind a permission. Tag and attendee-type values are supplied by the
 * server's own lookups and are only offered when their dimension is available.
 */
export function describeAvailableFilters(
  capabilities: AudienceCapabilities,
  options: {
    tags: ReadonlyArray<{ id: string; name: string }>;
    attendeeTypes: readonly string[];
  },
): { roles: Array<{ role: AudienceRole; label: string }>; filters: AvailableAudienceFilter[] } {
  const roles = AUDIENCE_ROLES.filter((role) => roleAvailable(role, capabilities)).map((role) => ({
    role,
    label: AUDIENCE_ROLE_LABELS[role],
  }));
  const filters: AvailableAudienceFilter[] = [];
  const add = (dimension: AudienceDimension, values: Array<{ value: string; label: string }>) => {
    if (!dimensionAvailable(dimension, capabilities) || dimension === "roles") return;
    filters.push({ dimension, label: AUDIENCE_DIMENSION_RULES[dimension].label, values });
  };
  add("lifecycles", AUDIENCE_LIFECYCLES.map((value) => ({ value, label: LIFECYCLE_LABELS[value] })));
  add("attendeeTypes", options.attendeeTypes.map((value) => ({ value, label: value })));
  add("tagIds", options.tags.map((tag) => ({ value: tag.id, label: tag.name })));
  add("balanceStates", AUDIENCE_BALANCE_STATES.map((value) => ({ value, label: BALANCE_LABELS[value] })));
  add("checkInStates", AUDIENCE_CHECK_IN_STATES.map((value) => ({ value, label: CHECK_IN_LABELS[value] })));
  add("readinessStates", AUDIENCE_READINESS_STATES.map((value) => ({ value, label: READINESS_LABELS[value] })));
  return { roles, filters };
}
