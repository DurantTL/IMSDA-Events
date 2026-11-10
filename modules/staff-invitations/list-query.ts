import { firstParam } from "@/lib/search-params";
import { parsePageParam } from "@/lib/pagination";
import { parseSortParams, type SortState } from "@/lib/list-sort";
import {
  INVITATION_FAILED_MESSAGE_STATUSES,
  INVITATION_FAILED_PROVIDER_STATUSES,
  INVITATION_LINK_MS,
  INVITATION_STATUSES,
  INVITATION_STATUS_LABEL,
  STAFF_INVITATION_GROUPS,
  type InvitationStatus,
  type StaffInvitationGroupValue,
} from "@/modules/staff-invitations/domain";

/**
 * The pure half of the staff invitation list (#1492): reading the address, the where-clause for each status, the whitelisted
 * orders and the limit on one bulk selection. The list is paged, searched, filtered and ordered in the database, so every
 * invitation is reachable. Client-safe.
 */

export const INVITATION_PAGE_SIZE = 50;

/** The most people one Send, resend or Revoke takes: the routes' own limit. "Select all N matching" stops here. */
export const INVITATION_BULK_LIMIT = 2000;

/** The whitelist of sortable columns. An address can only name one of these. */
export const INVITATION_SORT_COLUMNS = ["person", "group", "status"] as const;
export type InvitationSortColumn = (typeof INVITATION_SORT_COLUMNS)[number];

/** No `sort` in the address: the order the list always had (group, then name). */
export const INVITATION_DEFAULT_SORT: SortState<InvitationSortColumn> = { key: null, dir: "asc" };

export type InvitationListFilters = { status: InvitationStatus | "ALL"; group: StaffInvitationGroupValue | "ALL"; search: string };

export type InvitationListQuery = { filters: InvitationListFilters; sort: SortState<InvitationSortColumn>; page: number };

type RawParams = { status?: unknown; group?: unknown; q?: unknown; sort?: unknown; dir?: unknown; page?: unknown };

/** Reads `?status=`, `?group=` and `?q=`: anything that is not a listed value is "All" (or no search). */
export function parseInvitationFilters(params: RawParams): InvitationListFilters {
  const status = firstParam(params.status);
  const group = firstParam(params.group);
  const search = firstParam(params.q);
  return {
    status: typeof status === "string" && (INVITATION_STATUSES as readonly string[]).includes(status) ? (status as InvitationStatus) : "ALL",
    group: typeof group === "string" && (STAFF_INVITATION_GROUPS as readonly string[]).includes(group) ? (group as StaffInvitationGroupValue) : "ALL",
    search: typeof search === "string" ? search.trim().slice(0, 100) : "",
  };
}

export function parseInvitationQuery(params: RawParams): InvitationListQuery {
  const page = firstParam(params.page);
  return {
    filters: parseInvitationFilters(params),
    sort: parseSortParams(
      { sort: typeof params.sort === "string" ? params.sort : null, dir: typeof params.dir === "string" ? params.dir : null },
      INVITATION_SORT_COLUMNS,
      INVITATION_DEFAULT_SORT,
    ),
    page: parsePageParam(typeof page === "string" ? page : null),
  };
}

/** The status the person sees, as a database condition: the same rules as `invitationStatus`. */
export function invitationStatusWhere(status: InvitationStatus, now: Date = new Date()) {
  const failedMessage = { status: { in: [...INVITATION_FAILED_MESSAGE_STATUSES] } };
  const failedProvider = { providerDeliveryStatus: { in: [...INVITATION_FAILED_PROVIDER_STATUSES] } };
  // An open link past its 14 days is "Expired", whether or not it was sent, so the other open statuses need a live window.
  const windowStart = new Date(now.getTime() - INVITATION_LINK_MS);
  const open = { revokedAt: null, registeredAt: null, linkIssuedAt: { gt: windowStart } };
  switch (status) {
    case "REVOKED": return { revokedAt: { not: null } };
    case "APPROVED": return { revokedAt: null, registeredAt: { not: null }, approval: "APPROVED" };
    case "DECLINED": return { revokedAt: null, registeredAt: { not: null }, approval: "DECLINED" };
    case "REGISTERED": return { revokedAt: null, registeredAt: { not: null }, OR: [{ approval: null }, { approval: "WAITING" }] };
    case "EXPIRED": return { revokedAt: null, registeredAt: null, linkIssuedAt: { lte: windowStart } };
    case "NOT_SENT": return { ...open, sentAt: null };
    case "DELIVERY_FAILED": return { ...open, sentAt: { not: null }, lastMessage: { is: { OR: [failedMessage, failedProvider] } } };
    case "SENT": return {
      ...open,
      sentAt: { not: null },
      // Not failed: no message, or one whose status and provider status are both clear. A missing provider status is clear, so it is named.
      OR: [
        { lastMessage: { is: null } },
        { lastMessage: { is: { AND: [
          { status: { notIn: [...INVITATION_FAILED_MESSAGE_STATUSES] } },
          { OR: [{ providerDeliveryStatus: null }, { providerDeliveryStatus: { notIn: [...INVITATION_FAILED_PROVIDER_STATUSES] } }] },
        ] } } },
      ],
    };
  }
}

/** Every word of the search must appear in the email, first name or last name, so "ada love" finds Ada Lovelace. */
function searchWhere(search: string) {
  const words = search.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return { AND: words.map((word) => ({ OR: [
    { email: { contains: word, mode: "insensitive" } },
    { firstName: { contains: word, mode: "insensitive" } },
    { lastName: { contains: word, mode: "insensitive" } },
  ] })) };
}

/**
 * The event's current invitations (a person who was re-invited is listed once, by the new invitation) narrowed by the group
 * and the search; `status` is added too unless the caller asks for the status left out (the counts and the status sort).
 * The event is always part of the clause.
 */
export function buildInvitationWhere(eventId: string, filters: InvitationListFilters, options: { withStatus?: boolean; now?: Date } = {}) {
  const and: Array<Record<string, unknown>> = [];
  if (filters.group !== "ALL") and.push({ group: filters.group });
  const search = searchWhere(filters.search);
  if (search) and.push(search);
  if ((options.withStatus ?? true) && filters.status !== "ALL") and.push(invitationStatusWhere(filters.status, options.now));
  return { eventId, supersededAt: null, ...(and.length > 0 ? { AND: and } : {}) };
}

const nameOrder = (dir: "asc" | "desc") => [{ lastName: dir }, { firstName: dir }, { email: dir }, { id: "asc" }] as const;

/** The order for each whitelisted column (the default is group, then name). The id ends every order, so pages never overlap. Status is ordered by the repository, one status at a time. */
export function invitationOrderBy(sort: SortState<InvitationSortColumn>) {
  const dir = sort.dir;
  if (sort.key === "person") return [...nameOrder(dir)];
  if (sort.key === "group") return [{ group: dir }, ...nameOrder("asc")];
  if (sort.key === "status") return [...nameOrder("asc")];
  return [{ group: "asc" }, ...nameOrder("asc")];
}

/** The statuses in the order their words sort ("Approved" first), or the reverse, for the status column. */
export function invitationStatusSortOrder(dir: "asc" | "desc"): InvitationStatus[] {
  const ordered = [...INVITATION_STATUSES].sort((a, b) => INVITATION_STATUS_LABEL[a].localeCompare(INVITATION_STATUS_LABEL[b], "en"));
  return dir === "asc" ? ordered : ordered.reverse();
}

/** The address for the list: only what differs from the default is written. */
export function invitationListHref(basePath: string, eventId: string, query: InvitationListQuery): string {
  const params = new URLSearchParams();
  params.set("event", eventId);
  const { filters } = query;
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.group !== "ALL") params.set("group", filters.group);
  if (filters.search) params.set("q", filters.search);
  if (query.sort.key) { params.set("sort", query.sort.key); params.set("dir", query.sort.dir); }
  if (query.page > 1) params.set("page", String(query.page));
  return `${basePath}?${params.toString()}`;
}
