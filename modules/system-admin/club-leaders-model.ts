import { CLUB_ROLE_LABELS, CLUB_ROLE_VALUES, parsePeopleId, type ClubRoleValue } from "@/modules/system-admin/people-directory-model";
import { firstParam } from "@/lib/search-params";

/** The pure half of the Club leaders list (#1277): reading the URL, the where-clause and the sort order. */

/** One page of roles. The list is paged in the database, in the order below, so every page is a slice of the whole list (#1458). */
export const CLUB_LEADERS_PAGE_SIZE = 50;

/** Which people the list shows (#1589): current leaders, invites that were sent and wait, or invites not sent yet. */
export const CLUB_LEADER_STATUSES = ["current", "invited", "draft"] as const;
export type ClubLeaderStatus = (typeof CLUB_LEADER_STATUSES)[number];

export const CLUB_LEADER_STATUS_LABELS: Record<ClubLeaderStatus, string> = { current: "Current", invited: "Invited", draft: "Draft" };

/** `status` is optional so older callers that mean "current" keep working; the page always sets it. */
export type ClubLeaderFilters = { clubId: string | null; role: ClubRoleValue | null; status?: ClubLeaderStatus };

/** Reads `?status=`; anything else is Current. */
export function parseLeaderStatus(value: unknown): ClubLeaderStatus {
  const text = firstParam(value);
  if (typeof text !== "string") return "current";
  const lower = text.trim().toLowerCase();
  return (CLUB_LEADER_STATUSES as readonly string[]).includes(lower) ? (lower as ClubLeaderStatus) : "current";
}

/** Reads `?role=` as a club role (`director`, `deputy`, `registrar`, `reporter`); anything else is every role. */
export function parseLeaderRole(value: unknown): ClubRoleValue | null {
  const text = firstParam(value);
  if (typeof text !== "string") return null;
  const upper = text.trim().toUpperCase();
  return (CLUB_ROLE_VALUES as readonly string[]).includes(upper) ? (upper as ClubRoleValue) : null;
}

export function parseLeaderFilters(params: { club?: unknown; role?: unknown; status?: unknown }): ClubLeaderFilters {
  return { clubId: parsePeopleId(params.club), role: parseLeaderRole(params.role), status: parseLeaderStatus(params.status) };
}

/**
 * The invites behind the Invited and Draft views: Invited is SENT (waiting for the person), Draft is PENDING (not sent yet).
 * Accepted invites are current leaders and cancelled ones are gone, so neither status is ever asked for here.
 */
export function buildInvitesWhere(filters: ClubLeaderFilters) {
  return {
    status: filters.status === "draft" ? ("PENDING" as const) : ("SENT" as const),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.clubId ? { organizationId: filters.clubId } : {}),
  };
}

/** Club name, then Director first, then oldest first, then id (the order the Club invites page always used). */
export const CLUB_INVITES_ORDER_BY = [
  { organization: { name: "asc" } },
  { role: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
] as const;

/** Current roles only (not revoked, started, not ended), in active CLUB-type organizations only (the club picker offers active clubs). */
export function buildLeadersWhere(filters: ClubLeaderFilters, now = new Date()) {
  return {
    revokedAt: null,
    effectiveFrom: { lte: now },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    role: filters.role ? filters.role : { in: [...CLUB_ROLE_VALUES] },
    organization: { type: "CLUB", isActive: true, ...(filters.clubId ? { id: filters.clubId } : {}) },
  };
}

export type ClubLeader = {
  key: string;
  accountId: string;
  name: string;
  email: string;
  clubId: string;
  clubName: string;
  role: ClubRoleValue;
  roleLabel: string;
  /** Only a yes or no: an authenticator app or passkey is set up (#1410). */
  twoStepOn: boolean;
};

const roleOrder = new Map<string, number>(CLUB_ROLE_VALUES.map((role, index) => [role, index]));
const text = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

/** Club name, then Director, Deputy, Registrar, Reporter, then person name. */
export function sortClubLeaders<T extends Pick<ClubLeader, "clubName" | "role" | "name" | "email" | "key">>(leaders: readonly T[]): T[] {
  return [...leaders].sort((a, b) =>
    text(a.clubName, b.clubName)
    || (roleOrder.get(a.role) ?? 99) - (roleOrder.get(b.role) ?? 99)
    || text(a.name || a.email, b.name || b.email)
    || text(a.key, b.key));
}

export function leaderRoleLabel(role: ClubRoleValue): string {
  return CLUB_ROLE_LABELS[role];
}

/** The same order, as a database `orderBy`: club name, role in the enum's order (Director first), person name, then id. */
export const CLUB_LEADERS_ORDER_BY = [
  { organization: { name: "asc" } },
  { role: "asc" },
  { attendeeAccount: { displayName: "asc" } },
  { attendeeAccount: { email: "asc" } },
  { id: "asc" },
] as const;

export function clubLeadersHref(filters: ClubLeaderFilters, page = 1): string {
  const params = new URLSearchParams();
  if (filters.clubId) params.set("club", filters.clubId);
  if (filters.role) params.set("role", filters.role.toLowerCase());
  if (filters.status && filters.status !== "current") params.set("status", filters.status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/clubs/leaders?${query}` : "/admin/clubs/leaders";
}
