import { createHash } from "node:crypto";
import { z } from "zod";
import type { EventPermission } from "@/modules/access/permissions";
import {
  FILTER_KEYS,
  availableOperationsFilters,
  emptyOperationsSearchQuery,
  parseOperationsSearchParams,
  serializeOperationsSearchQuery,
  type OperationsSearchQuery,
  type SearchCatalog,
  type SearchFilterDescriptor,
  type SearchViewer,
} from "@/modules/registrations/operations-search-domain";

/**
 * The query contract of the reviewed event audience builder (#176), the pure half.
 *
 * A query says who an event message would reach. It is preview-only data: nothing here sends, schedules or queues a
 * message, and the query holds no address, name or note.
 *
 * WHICH REGISTRATIONS is not decided here. It is the operations search (#180): the query carries `search`, the canonical
 * URL-safe operations-search query string, and the repository runs it through that service, so the audience builder and
 * the staff lists share one definition of "who matches", one set of filter keys, one permission model per domain and one
 * rule for what can never be searched (note bodies, consent evidence, health and sensitive answers, event membership).
 * This module adds only what is specific to a message: who on a matched registration is written to (roles), the kind of
 * message (which opt-outs apply), and one normalized readiness status.
 *
 * A filter the viewer may not use, or whose domain the event lacks, is refused with one generic answer that names no
 * value and no count, so a refusal teaches nothing about what the event holds. The query is normalized (the search
 * re-serialized to its canonical form with paging and sort reset, defaults filled in) before it is hashed, so equal
 * questions always produce equal hashes and fingerprints.
 */

/**
 * Bump when the meaning of a query, or how an audience is evaluated from it, changes. Stored on every snapshot.
 * v2 (#180): registration selection is the operations search, carried as its canonical query string.
 */
export const AUDIENCE_QUERY_VERSION = "audience-query/2";

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
  GROUP_LEADER: "Group billing contact",
  ORGANIZATION_CONTACT: "Approved organization contact",
};

/** Deterministic order a recipient's display name and primary role are chosen in. */
export const AUDIENCE_ROLE_PRIORITY: Record<AudienceRole, number> = {
  REGISTRATION_CONTACT: 0,
  GROUP_LEADER: 1,
  ORGANIZATION_CONTACT: 2,
  ATTENDEE: 3,
};

/** DRAFT is never an audience: a draft is not yet a registrant. No lifecycle chosen means these. */
export const DEFAULT_AUDIENCE_LIFECYCLES = ["SUBMITTED", "CONFIRMED"] as const;

/**
 * Approved normalized actionable statuses only. A readiness value says that something needs doing, derived from
 * whether data exists, never from what the data says. Medical, screening, consent evidence and notes can never be
 * a value here. The operations search has no such filter, so this is the one audience-specific narrowing; it is applied
 * to registrations the search already selected and can only remove, never add.
 */
export const AUDIENCE_READINESS_STATES = ["ATTENDEE_RESPONSES_INCOMPLETE"] as const;
export type AudienceReadinessState = (typeof AUDIENCE_READINESS_STATES)[number];

/** What kind of message the audience is for. Only announcements honour an announcement opt-out (#838). */
export const AUDIENCE_MESSAGE_KINDS = ["ANNOUNCEMENT", "OPERATIONAL"] as const;
export type AudienceMessageKind = (typeof AUDIENCE_MESSAGE_KINDS)[number];

export const AUDIENCE_DOMAINS = ["REGISTRATION", "GROUPS", "ORGANIZATIONS"] as const;
export type AudienceDomain = (typeof AUDIENCE_DOMAINS)[number];

/** Reason dimensions: the operations-search filter keys, the recipient role, and readiness. */
export const AUDIENCE_DIMENSIONS = ["roles", ...FILTER_KEYS, "readiness"] as const;
export type AudienceDimension = (typeof AUDIENCE_DIMENSIONS)[number];

/** Held in addition to MANAGE_COMMUNICATIONS, which the whole builder needs, to use the readiness narrowing. */
export const READINESS_PERMISSION: EventPermission = "MANAGE_REGISTRATION";

/** A role is itself gated by its domain: group and organization contacts exist only on events that have them. */
export const AUDIENCE_ROLE_DOMAINS: Record<AudienceRole, AudienceDomain> = {
  REGISTRATION_CONTACT: "REGISTRATION",
  ATTENDEE: "REGISTRATION",
  GROUP_LEADER: "GROUPS",
  ORGANIZATION_CONTACT: "ORGANIZATIONS",
};

/**
 * Permission each role needs on top of MANAGE_COMMUNICATIONS, which the whole builder needs. Messaging an attendee or a
 * group's billing person reaches people by name and address, minors included, so it needs VIEW_SENSITIVE_DATA; an
 * organization's billing contact is finance data, so it needs MANAGE_FINANCE. The registration contact is the person who
 * registered and needs nothing more. The GROUP_LEADER key stays for stored queries; the person it names is the group
 * registration's billing person, and its label says so.
 */
export const AUDIENCE_ROLE_PERMISSIONS: Record<AudienceRole, EventPermission | null> = {
  REGISTRATION_CONTACT: null,
  ATTENDEE: "VIEW_SENSITIVE_DATA",
  GROUP_LEADER: "VIEW_SENSITIVE_DATA",
  ORGANIZATION_CONTACT: "MANAGE_FINANCE",
};

/** Strict: an unknown key (a note, medical or consent field, say) is a validation error, not a quiet no-op. */
export const audienceQuerySchema = z.strictObject({
  messageKind: z.enum(AUDIENCE_MESSAGE_KINDS).default("ANNOUNCEMENT"),
  roles: z.array(z.enum(AUDIENCE_ROLES)).max(AUDIENCE_ROLES.length).default(["REGISTRATION_CONTACT"]),
  /**
   * The operations-search query string (the URL form the staff lists use, for example `status=CONFIRMED&tag=abc`).
   * Sort, page and size are presentation and are ignored. An empty string selects the default lifecycles.
   */
  search: z.string().max(4_000).default(""),
  readinessStates: z.array(z.enum(AUDIENCE_READINESS_STATES)).max(AUDIENCE_READINESS_STATES.length).optional(),
});

export type AudienceQueryInput = z.input<typeof audienceQuerySchema>;

export type NormalizedAudienceQuery = {
  messageKind: AudienceMessageKind;
  roles: AudienceRole[];
  /** Canonical operations-search query string: sorted, de-duplicated, defaults filled in, sort and paging reset. */
  search: string;
  readinessStates: AudienceReadinessState[];
};

function sortedUnique<T extends string>(values: readonly T[] | undefined): T[] {
  return [...new Set(values ?? [])].sort();
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
 * The operations-search query an audience query runs. The search is re-read from its canonical string, so the audience
 * always evaluates the form that was hashed. A normalized query always parses without issues.
 */
export function audienceSearchQuery(query: Pick<NormalizedAudienceQuery, "search">): OperationsSearchQuery {
  return parseOperationsSearchParams(new URLSearchParams(query.search)).query;
}

/** An empty list means "this dimension is not filtered", for every dimension but roles (defaulted) and lifecycle (see below). */
export function normalizeAudienceQuery(input: unknown): NormalizedAudienceQuery {
  const parsed = audienceQuerySchema.parse(input);
  const roles = sortedUnique(parsed.roles);
  const { query: search, issues } = parseOperationsSearchParams(new URLSearchParams(parsed.search));
  // A malformed search is refused like an unavailable one: nothing is half-read.
  if (issues.length > 0) throw new AudienceFilterNotAvailableError();
  // A draft is never an audience, and no lifecycle chosen means the registrants who are still coming.
  if ((search.status as string[]).includes("DRAFT")) throw new AudienceFilterNotAvailableError();
  if (search.status.length === 0) search.status = [...DEFAULT_AUDIENCE_LIFECYCLES];
  const presentation = emptyOperationsSearchQuery();
  search.sort = presentation.sort;
  search.direction = presentation.direction;
  search.page = presentation.page;
  search.pageSize = presentation.pageSize;
  return {
    messageKind: parsed.messageKind,
    roles: roles.length ? roles : ["REGISTRATION_CONTACT"],
    search: serializeOperationsSearchQuery(search),
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

export function roleAvailable(role: AudienceRole, capabilities: AudienceCapabilities) {
  const permission = AUDIENCE_ROLE_PERMISSIONS[role];
  return capabilities.domains.has(AUDIENCE_ROLE_DOMAINS[role]) && (permission === null || capabilities.permissions.has(permission));
}

/**
 * With the ATTENDEE role the search still selects registrations, but only the attendee-type and tag filters are decided
 * per attendee. Free text, a check-in state and an attendee-scoped form answer are facts about people the message would
 * not be filtered by, so they are refused rather than quietly reaching every attendee of a matched registration.
 * An answer id is `${scope}:${field key}`.
 */
export function attendeeRoleSearchRefused(query: Pick<NormalizedAudienceQuery, "search">) {
  const search = audienceSearchQuery(query);
  return Boolean(search.text) || Boolean(search.checkIn) || search.answers.some((answer) => answer.question.startsWith("ATTENDEE:"));
}

export function readinessAvailable(capabilities: AudienceCapabilities) {
  return capabilities.permissions.has(READINESS_PERMISSION);
}

/**
 * Refuses what the caller may not use in the audience-specific part of a query: a role whose domain the event lacks or whose permission the caller lacks, or
 * the readiness narrowing without its permission. The search filters are decided by the operations search itself (its
 * `resolveOperationsSearch`), which the repository runs before anything is read. Every refusal is the same fixed error.
 */
export function assertQueryAvailable(query: NormalizedAudienceQuery, capabilities: AudienceCapabilities) {
  for (const role of query.roles) {
    if (!roleAvailable(role, capabilities)) throw new AudienceFilterNotAvailableError();
  }
  if (query.roles.includes("ATTENDEE") && attendeeRoleSearchRefused(query)) throw new AudienceFilterNotAvailableError();
  if (query.readinessStates.length > 0 && !readinessAvailable(capabilities)) throw new AudienceFilterNotAvailableError();
}

/** The viewer the operations search sees: the caller's own permissions for this one event. */
export function searchViewerFor(eventId: string, permissions: readonly string[]): SearchViewer {
  return { eventId, permissions: permissions as readonly EventPermission[] };
}

export type AvailableAudienceFilters = {
  roles: Array<{ role: AudienceRole; label: string }>;
  /** The operations-search filter descriptors this caller may use on this event, minus the one value an audience never takes (DRAFT). */
  search: SearchFilterDescriptor[];
  readiness: Array<{ value: AudienceReadinessState; label: string }>;
};

const READINESS_LABELS: Record<AudienceReadinessState, string> = {
  ATTENDEE_RESPONSES_INCOMPLETE: "Attendee responses incomplete",
};

/**
 * The filters this caller may compose. They are exactly `availableOperationsFilters` (the one list the staff lists
 * render), so a filter the viewer may not use is absent, not empty: the list never says something exists behind a
 * permission. The audience adds its roles (only those whose domain the event has) and readiness (only with its permission).
 */
export function describeAvailableFilters(
  viewer: SearchViewer,
  catalog: SearchCatalog,
  capabilities: AudienceCapabilities,
): AvailableAudienceFilters {
  const search = availableOperationsFilters(viewer, catalog).map((filter): SearchFilterDescriptor => (
    filter.key === "status"
      ? { ...filter, options: filter.options.filter((option) => option.value !== "DRAFT") }
      : filter
  ));
  return {
    roles: AUDIENCE_ROLES.filter((role) => roleAvailable(role, capabilities)).map((role) => ({ role, label: AUDIENCE_ROLE_LABELS[role] })),
    search,
    readiness: readinessAvailable(capabilities)
      ? AUDIENCE_READINESS_STATES.map((value) => ({ value, label: READINESS_LABELS[value] }))
      : [],
  };
}
