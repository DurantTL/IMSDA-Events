import { CLUB_ROLE_LABELS, CLUB_ROLE_VALUES, parsePeopleId, type ClubRoleValue } from "@/modules/system-admin/people-directory-model";
import { firstParam } from "@/lib/search-params";

/** The pure half of the Club leaders list (#1277): reading the URL, the where-clause and the sort order. */

export const CLUB_LEADERS_MAX_ROWS = 2000;

export type ClubLeaderFilters = { clubId: string | null; role: ClubRoleValue | null };

/** Reads `?role=` as a club role (`director`, `deputy`, `registrar`, `reporter`); anything else is every role. */
export function parseLeaderRole(value: unknown): ClubRoleValue | null {
  const text = firstParam(value);
  if (typeof text !== "string") return null;
  const upper = text.trim().toUpperCase();
  return (CLUB_ROLE_VALUES as readonly string[]).includes(upper) ? (upper as ClubRoleValue) : null;
}

export function parseLeaderFilters(params: { club?: unknown; role?: unknown }): ClubLeaderFilters {
  return { clubId: parsePeopleId(params.club), role: parseLeaderRole(params.role) };
}

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

export function clubLeadersHref(filters: ClubLeaderFilters): string {
  const params = new URLSearchParams();
  if (filters.clubId) params.set("club", filters.clubId);
  if (filters.role) params.set("role", filters.role.toLowerCase());
  const query = params.toString();
  return query ? `/admin/clubs/leaders?${query}` : "/admin/clubs/leaders";
}
