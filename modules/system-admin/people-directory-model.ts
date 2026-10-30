/**
 * The pure half of the People & access directory (#1275): merging staff logins and website
 * accounts into one list of people and paging it. No database, so it is unit tested directly.
 */

import { eventRoles, type EventRole } from "@/modules/access/permissions";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";
import { clubRoleText, eventRoleText, systemRoleText } from "@/modules/access/role-descriptions";
import { firstParam } from "@/lib/search-params";
import { clampPage, pageCountFor } from "@/lib/pagination";

export const PEOPLE_PAGE_SIZE = 25;

export type PeopleCandidate = {
  kind: "staff" | "account";
  id: string;
  name: string;
  email: string;
  /** The id of the other kind this one is linked to (`User.attendeeAccountId`), if any. */
  linkedId: string | null;
};

export type MergedPerson = {
  /** Stable key: the staff id when there is a staff login, else the account id. */
  key: string;
  staffId: string | null;
  accountId: string | null;
  name: string;
  email: string;
};

function compareText(a: string, b: string) {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

/**
 * One row per person: a staff login and the website account linked to it collapse into one entry,
 * even when only one side matched the search. The staff side's name and email win. Sorted by name,
 * then email, then key, so paging is stable.
 */
export function mergePeopleCandidates(
  staff: readonly PeopleCandidate[],
  accounts: readonly PeopleCandidate[],
): MergedPerson[] {
  const byStaff = new Map<string, MergedPerson>();
  const byAccount = new Map<string, MergedPerson>();
  const people: MergedPerson[] = [];

  for (const user of staff) {
    if (byStaff.has(user.id)) continue;
    const person: MergedPerson = {
      key: user.id,
      staffId: user.id,
      accountId: user.linkedId,
      name: user.name,
      email: user.email,
    };
    byStaff.set(user.id, person);
    if (user.linkedId) byAccount.set(user.linkedId, person);
    people.push(person);
  }
  for (const account of accounts) {
    if (byAccount.has(account.id)) continue;
    const linkedStaff = account.linkedId ? byStaff.get(account.linkedId) : undefined;
    if (linkedStaff) {
      linkedStaff.accountId = account.id;
      byAccount.set(account.id, linkedStaff);
      continue;
    }
    const person: MergedPerson = {
      key: account.linkedId ?? account.id,
      staffId: account.linkedId,
      accountId: account.id,
      name: account.name,
      email: account.email,
    };
    byAccount.set(account.id, person);
    if (account.linkedId) byStaff.set(account.linkedId, person);
    people.push(person);
  }

  return people.sort((a, b) => compareText(a.name, b.name) || compareText(a.email, b.email) || compareText(a.key, b.key));
}

export type PeoplePage<T> = {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
};

/** A 1-based page, clamped into range, so `?page=999` shows the last page rather than nothing. */
export function pagePeople<T>(items: readonly T[], requestedPage: number, pageSize = PEOPLE_PAGE_SIZE): PeoplePage<T> {
  const pageCount = pageCountFor(items.length, pageSize);
  const page = clampPage(requestedPage, items.length, pageSize);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageCount, total: items.length, pageSize };
}

/** Reads `?page=` as a positive integer; anything else is page 1. */
export function parsePeoplePage(value: unknown): number {
  const text = firstParam(value);
  if (typeof text !== "string" || !/^\d{1,6}$/.test(text)) return 1;
  return Math.max(1, Number(text));
}

/** Reads `?q=` trimmed and capped. */
export function parsePeopleQuery(value: unknown): string {
  const text = firstParam(value);
  return typeof text === "string" ? text.trim().slice(0, 120) : "";
}

export type AccessSummaryInput = {
  systemAdministrator: boolean;
  clubsAdministrator: boolean;
  areaCoordinator: boolean;
  activeEventCount: number;
  activeClubRoleCount: number;
};

/** The short access line on a list row: "System administrator", "3 events", "2 club roles". */
export function summarizePeopleAccess(input: AccessSummaryInput): string[] {
  const parts: string[] = [];
  if (input.systemAdministrator) parts.push(systemRoleText.SYSTEM_ADMIN.name);
  if (input.clubsAdministrator) parts.push(systemRoleText.CLUBS_ADMIN.name);
  if (input.areaCoordinator) parts.push(systemRoleText.AREA_COORDINATOR.name);
  if (input.activeEventCount > 0) parts.push(`${input.activeEventCount} ${input.activeEventCount === 1 ? "event" : "events"}`);
  if (input.activeClubRoleCount > 0) parts.push(`${input.activeClubRoleCount} club ${input.activeClubRoleCount === 1 ? "role" : "roles"}`);
  return parts;
}

/** The path of a person's page. A linked pair opens the same person from either id. */
export function personPath(person: Pick<MergedPerson, "staffId" | "accountId">): string {
  return person.staffId ? `/admin/people/staff/${person.staffId}` : `/admin/people/account/${person.accountId}`;
}

export type ClubRoleStatus = "active" | "scheduled" | "ended" | "revoked";

/**
 * Where a club role stands now, by the same rule the rest of the app uses (`listDirectedClubs`, `listClubTeam`):
 * current only when it is not revoked, has started (`effectiveFrom <= now`) and has not ended (`effectiveTo > now`).
 */
export function clubRoleStatus(
  grant: { revokedAt: Date | null; effectiveFrom: Date; effectiveTo: Date | null },
  now = new Date(),
): ClubRoleStatus {
  if (grant.revokedAt) return "revoked";
  if (grant.effectiveFrom > now) return "scheduled";
  if (grant.effectiveTo && grant.effectiveTo <= now) return "ended";
  return "active";
}

/** Who is looking: a system administrator sees everything, a Clubs Administrator only Area Coordinator and club roles. */
export type PeopleScope = "full" | "clubs";

/* "Who has this role" filters (#1277). Pure: parsing the URL and building the where-clauses. */

export const EVENT_ROLE_VALUES = [
  "EVENT_ADMIN", "REGISTRATION_MANAGER", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF", "KITCHEN_STAFF",
] as const;
export type EventRoleValue = (typeof EVENT_ROLE_VALUES)[number];
export const CLUB_ROLE_VALUES = ["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] as const;
export type ClubRoleValue = (typeof CLUB_ROLE_VALUES)[number];

export const EVENT_ROLE_LABELS: Record<EventRoleValue, string> = {
  EVENT_ADMIN: eventRoleText.EVENT_ADMIN.name,
  REGISTRATION_MANAGER: eventRoleText.REGISTRATION_MANAGER.name,
  FINANCE_MANAGER: eventRoleText.FINANCE_MANAGER.name,
  COMMUNICATIONS_MANAGER: eventRoleText.COMMUNICATIONS_MANAGER.name,
  CHECK_IN_STAFF: eventRoleText.CHECK_IN_STAFF.name,
  READ_ONLY_STAFF: eventRoleText.READ_ONLY_STAFF.name,
  KITCHEN_STAFF: eventRoleText.KITCHEN_STAFF.name,
};
export const CLUB_ROLE_LABELS: Record<ClubRoleValue, string> = {
  DIRECTOR: clubRoleText.DIRECTOR.name,
  DEPUTY: clubRoleText.DEPUTY.name,
  REGISTRAR: clubRoleText.REGISTRAR.name,
  REPORTER: clubRoleText.REPORTER.name,
};

export type PeopleRoleFilter =
  | { kind: "system-admin" }
  | { kind: "clubs-admin" }
  | { kind: "area-coordinator" }
  | { kind: "pending" }
  | { kind: "event"; role: EventRoleValue }
  | { kind: "club"; role: ClubRoleValue };

const kebab = (value: string) => value.toLowerCase().replace(/_/g, "-");

/** The `?role=` value of a filter, e.g. `event-check-in-staff` or `club-deputy`. */
export function peopleRoleKey(filter: PeopleRoleFilter): string {
  if (filter.kind === "event") return `event-${kebab(filter.role)}`;
  if (filter.kind === "club") return `club-${kebab(filter.role)}`;
  return filter.kind;
}

export function peopleRoleLabel(filter: PeopleRoleFilter): string {
  switch (filter.kind) {
    case "system-admin": return systemRoleText.SYSTEM_ADMIN.name;
    case "clubs-admin": return systemRoleText.CLUBS_ADMIN.name;
    case "area-coordinator": return systemRoleText.AREA_COORDINATOR.name;
    case "pending": return "Pending invites";
    case "event": return EVENT_ROLE_LABELS[filter.role];
    case "club": return CLUB_ROLE_LABELS[filter.role];
  }
}

export type PeopleRoleOptionGroup = { label: "System" | "Event" | "Club" | "Invites"; options: Array<{ key: string; label: string }> };

function allRoleFilters(): Array<{ group: PeopleRoleOptionGroup["label"]; filter: PeopleRoleFilter }> {
  return [
    { group: "System", filter: { kind: "system-admin" } },
    { group: "System", filter: { kind: "clubs-admin" } },
    { group: "System", filter: { kind: "area-coordinator" } },
    ...EVENT_ROLE_VALUES.map((role) => ({ group: "Event" as const, filter: { kind: "event", role } as PeopleRoleFilter })),
    ...CLUB_ROLE_VALUES.map((role) => ({ group: "Club" as const, filter: { kind: "club", role } as PeopleRoleFilter })),
    { group: "Invites", filter: { kind: "pending" } },
  ];
}

/** Whether a Clubs Administrator ("clubs") may use this filter: Area Coordinator, club roles and pending invites only. */
export function roleAllowedForScope(filter: PeopleRoleFilter, scope: PeopleScope): boolean {
  if (scope === "full") return true;
  return filter.kind === "area-coordinator" || filter.kind === "club" || filter.kind === "pending";
}

/** The grouped role choices for the select, limited to what the viewer's scope may use. */
export function peopleRoleOptions(scope: PeopleScope): PeopleRoleOptionGroup[] {
  const groups = new Map<PeopleRoleOptionGroup["label"], PeopleRoleOptionGroup>();
  for (const { group, filter } of allRoleFilters()) {
    if (!roleAllowedForScope(filter, scope)) continue;
    const entry = groups.get(group) ?? { label: group, options: [] };
    entry.options.push({ key: peopleRoleKey(filter), label: peopleRoleLabel(filter) });
    groups.set(group, entry);
  }
  return [...groups.values()];
}

/** Most values kept per filter dimension, so a crafted link cannot build a huge query. */
export const MAX_PEOPLE_FILTER_VALUES = 30;
/** The quick select's "several chosen" option: keep the values the Filters panel set (read from `keep*`). */
export const PEOPLE_FILTER_SEVERAL = "__several";

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/** Reads every `?role=`: unknown values and ones the viewer's scope may not use (system or event roles for a Clubs Administrator) are dropped. */
export function parsePeopleRoles(value: unknown, scope: PeopleScope): PeopleRoleFilter[] {
  const seen = new Set<string>();
  const roles: PeopleRoleFilter[] = [];
  for (const item of asList(value)) {
    if (typeof item !== "string") continue;
    const found = allRoleFilters().find(({ filter }) => peopleRoleKey(filter) === item.trim());
    if (!found || !roleAllowedForScope(found.filter, scope)) continue;
    const key = peopleRoleKey(found.filter);
    if (seen.has(key)) continue;
    seen.add(key);
    roles.push(found.filter);
    if (roles.length >= MAX_PEOPLE_FILTER_VALUES) break;
  }
  return roles;
}

/** The first valid `?role=`, or null (the single-value reader from #1277). */
export function parsePeopleRole(value: unknown, scope: PeopleScope): PeopleRoleFilter | null {
  return parsePeopleRoles(Array.isArray(value) ? value.slice(0, 1) : value, scope)[0] ?? null;
}

/** Reads `?event=` / `?club=`: an id (letters, digits, `_`, `-`), or nothing. */
export function parsePeopleId(value: unknown): string | null {
  const text = firstParam(value);
  return typeof text === "string" && /^[\w-]{1,64}$/.test(text.trim()) ? text.trim() : null;
}

/** Every valid id in a repeated `?event=` / `?club=`, deduplicated, in URL order. */
export function parsePeopleIds(value: unknown): string[] {
  const ids: string[] = [];
  for (const item of asList(value)) {
    const id = parsePeopleId(item);
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_PEOPLE_FILTER_VALUES) break;
  }
  return ids;
}

export type PeopleFilters = { roles: PeopleRoleFilter[]; eventIds: string[]; clubIds: string[] };

export const NO_PEOPLE_FILTERS: PeopleFilters = { roles: [], eventIds: [], clubIds: [] };

/**
 * Keeps filters tidy: event ids only for a full viewer, and Pending invites (a list view, not a role) only when it is
 * the one filter chosen. Event and club ids work without a matching role: they mean any event role at those events and
 * any club role at those clubs.
 */
export function tidyPeopleFilters(filters: PeopleFilters, scope: PeopleScope): PeopleFilters {
  const roles = filters.roles.filter((role) => roleAllowedForScope(role, scope));
  const eventIds = scope === "full" ? filters.eventIds : [];
  const clubIds = filters.clubIds;
  const alone = roles.length === 1 && eventIds.length === 0 && clubIds.length === 0;
  return { roles: alone ? roles : roles.filter((role) => role.kind !== "pending"), eventIds, clubIds };
}

export type PeopleFilterParams = {
  role?: unknown;
  event?: unknown;
  club?: unknown;
  /** Set by the quick selects' hidden inputs; used when the select says "Several" (no JavaScript needed). */
  keepRole?: unknown;
  keepEvent?: unknown;
  keepClub?: unknown;
};

const withSeveral = (value: unknown, keep: unknown): unknown =>
  asList(value).some((item) => item === PEOPLE_FILTER_SEVERAL) ? asList(keep) : value;

export function parsePeopleFilters(params: PeopleFilterParams, scope: PeopleScope): PeopleFilters {
  return tidyPeopleFilters({
    roles: parsePeopleRoles(withSeveral(params.role, params.keepRole), scope),
    eventIds: parsePeopleIds(withSeveral(params.event, params.keepEvent)),
    clubIds: parsePeopleIds(withSeveral(params.club, params.keepClub)),
  }, scope);
}

/** Removes event and club ids the viewer cannot choose from. Ignored means removed, so chips only show real values. */
export function keepKnownFilterIds(
  filters: PeopleFilters,
  eventOptions: readonly { id: string }[],
  clubOptions: readonly { id: string }[],
): PeopleFilters {
  const events = new Set(eventOptions.map((event) => event.id));
  const clubs = new Set(clubOptions.map((club) => club.id));
  return {
    roles: filters.roles,
    eventIds: filters.eventIds.filter((id) => events.has(id)),
    clubIds: filters.clubIds.filter((id) => clubs.has(id)),
  };
}

export function peopleFilterCount(filters: PeopleFilters): number {
  return filters.roles.length + filters.eventIds.length + filters.clubIds.length;
}

/** `/admin/people` with the search, filters and page kept in the URL (repeated `role`, `event` and `club`). */
export function peopleHref(input: { query?: string; page?: number; filters?: PeopleFilters }): string {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  for (const role of input.filters?.roles ?? []) params.append("role", peopleRoleKey(role));
  for (const id of input.filters?.eventIds ?? []) params.append("event", id);
  for (const id of input.filters?.clubIds ?? []) params.append("club", id);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  const text = params.toString();
  return text ? `/admin/people?${text}` : "/admin/people";
}

export type PeopleFilterChip = { key: string; label: string; removeLabel: string; href: string };

/** One chip per active filter, each linking to the same list without that value (page back to 1). */
export function peopleFilterChips(input: {
  filters: PeopleFilters;
  query: string;
  scope: PeopleScope;
  eventOptions: readonly { id: string; name: string }[];
  clubOptions: readonly { id: string; name: string }[];
}): PeopleFilterChip[] {
  const { filters, query, scope } = input;
  const href = (next: PeopleFilters) => peopleHref({ query, filters: tidyPeopleFilters(next, scope) });
  const name = (list: readonly { id: string; name: string }[], id: string) => list.find((item) => item.id === id)?.name ?? id;
  return [
    ...filters.roles.map((role) => ({
      key: `role-${peopleRoleKey(role)}`,
      label: `Role: ${peopleRoleLabel(role)}`,
      href: href({ ...filters, roles: filters.roles.filter((item) => peopleRoleKey(item) !== peopleRoleKey(role)) }),
    })),
    ...filters.eventIds.map((id) => ({
      key: `event-${id}`,
      label: `Event: ${name(input.eventOptions, id)}`,
      href: href({ ...filters, eventIds: filters.eventIds.filter((item) => item !== id) }),
    })),
    ...filters.clubIds.map((id) => ({
      key: `club-${id}`,
      label: `Club: ${name(input.clubOptions, id)}`,
      href: href({ ...filters, clubIds: filters.clubIds.filter((item) => item !== id) }),
    })),
  ].map((chip) => ({ ...chip, removeLabel: `Remove filter ${chip.label}` }));
}

/**
 * "System administrator, or Director or Deputy in 2 clubs" for the result count; empty when nothing is chosen. Clubs
 * and events are attached only to the club and event role parts. Ids with no role of their kind read "a club role in X".
 */
export function peopleFilterSummary(
  filters: PeopleFilters,
  names: { eventOptions: readonly { id: string; name: string }[]; clubOptions: readonly { id: string; name: string }[] },
): string {
  const where = (ids: string[], list: readonly { id: string; name: string }[], word: string, many: string) =>
    ids.length === 0 ? "" : ids.length === 1 ? ` ${word} ${list.find((item) => item.id === ids[0])?.name ?? `1 ${many.replace(/s$/, "")}`}` : ` ${word} ${ids.length} ${many}`;
  const labels = (kind: PeopleRoleFilter["kind"]) => filters.roles.filter((role) => role.kind === kind).map(peopleRoleLabel);
  const groups = [filters.roles.filter((role) => role.kind !== "club" && role.kind !== "event").map(peopleRoleLabel).join(" or ")];
  const eventLabels = labels("event");
  const clubLabels = labels("club");
  if (eventLabels.length > 0 || filters.eventIds.length > 0) {
    groups.push(`${eventLabels.length > 0 ? eventLabels.join(" or ") : "an event role"}${where(filters.eventIds, names.eventOptions, "at", "events")}`);
  }
  if (clubLabels.length > 0 || filters.clubIds.length > 0) {
    groups.push(`${clubLabels.length > 0 ? clubLabels.join(" or ") : "a club role"}${where(filters.clubIds, names.clubOptions, "in", "clubs")}`);
  }
  return groups.filter(Boolean).join(", or ");
}

export type PeopleRoleWhere = {
  staff?: Record<string, unknown>;
  account?: Record<string, unknown>;
};

const oneOrAny = (clauses: Record<string, unknown>[]): Record<string, unknown> | undefined =>
  clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { OR: clauses };

/**
 * The where-clauses that find the people who hold any chosen role right now (several roles are OR). `staff` is for
 * `User`, `account` for `AttendeeAccount`. `null` for Pending invites (listed by its own module) and when nothing can
 * be listed: event roles with no event picked list nobody across every event. Roles the scope may not use are ignored
 * here as well as in parsing, and a Clubs Administrator's club roles are limited to CLUB-type organizations.
 */
export function buildRoleWhere(filters: PeopleFilters, scope: PeopleScope, now = new Date()): PeopleRoleWhere | null {
  const roles = filters.roles.filter((role) => roleAllowedForScope(role, scope));
  const staff: Record<string, unknown>[] = [];
  const account: Record<string, unknown>[] = [];
  const eventRolesChosen = roles.flatMap((role) => (role.kind === "event" ? [role.role] : []));
  const clubRolesChosen = roles.flatMap((role) => (role.kind === "club" ? [role.role] : []));
  const eventIds = scope === "full" ? filters.eventIds : [];
  if (roles.some((role) => role.kind === "system-admin")) staff.push({ globalRole: "SYSTEM_ADMIN" });
  if (roles.some((role) => role.kind === "clubs-admin")) staff.push({ clubsAdministratorGrant: { is: { revokedAt: null } } });
  if (roles.some((role) => role.kind === "area-coordinator")) {
    account.push({ areaCoordinatorGrant: { is: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } });
  }
  // Picked events with no event role mean any event role at them; picked clubs with no club role, any club role at them.
  const eventRoleList = eventRolesChosen.length > 0 ? eventRolesChosen : eventIds.length > 0 ? [...EVENT_ROLE_VALUES] : [];
  if (eventRoleList.length > 0 && eventIds.length > 0) {
    staff.push({ memberships: { some: { role: { in: eventRoleList }, status: "ACTIVE", eventId: { in: eventIds } } } });
  }
  const clubRoleList = clubRolesChosen.length > 0 ? clubRolesChosen : filters.clubIds.length > 0 ? [...CLUB_ROLE_VALUES] : [];
  if (clubRoleList.length > 0) {
    account.push({
      clubDirectorGrants: {
        some: {
          role: { in: clubRoleList },
          revokedAt: null,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          organization: {
            isActive: true,
            ...(scope === "clubs" ? { type: "CLUB" } : {}),
            ...(filters.clubIds.length > 0 ? { id: { in: filters.clubIds } } : {}),
          },
        },
      },
    });
  }
  const where: PeopleRoleWhere = {};
  const staffWhere = oneOrAny(staff);
  const accountWhere = oneOrAny(account);
  if (staffWhere) where.staff = staffWhere;
  if (accountWhere) where.account = accountWhere;
  return where.staff || where.account ? where : null;
}

/** True when the chosen roles are all event roles and no event (or club) is picked, so nothing can be listed yet. */
export function needsEventPick(filters: PeopleFilters): boolean {
  const hasEventRole = filters.roles.some((role) => role.kind === "event");
  return hasEventRole && filters.eventIds.length === 0 && filters.clubIds.length === 0 && filters.roles.every((role) => role.kind === "event");
}

/** True when event roles are mixed with other roles but no event is picked, so those roles list nobody yet. */
export function eventRolesNeedEvent(filters: PeopleFilters): boolean {
  return filters.roles.some((role) => role.kind === "event") && filters.eventIds.length === 0 && !needsEventPick(filters);
}

// ---------------------------------------------------------------- Chosen in the invite (#1276)

/** One piece of access chosen in the Invite a person dialog. */
export type GrantItem =
  | { type: "sa" }
  | { type: "ca" }
  | { type: "ac" }
  | { type: "event"; eventId: string; role: EventRole }
  | { type: "club"; organizationId: string; role: ClubRole };

/** The most items one `?grant=` link carries. */
export const GRANT_ITEM_CAP = 20;

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const clubRoles = Object.keys(clubDirectorRoleLabels) as ClubRole[];

export function grantKey(item: GrantItem): string {
  if (item.type === "event") return `e:${item.eventId}:${item.role}`;
  if (item.type === "club") return `c:${item.organizationId}:${item.role}`;
  return item.type;
}

/** System administrator, Clubs Administrator and event roles live on a staff login; Area Coordinator and club roles on a website account. */
export function isStaffSideGrant(item: GrantItem): boolean {
  return item.type === "sa" || item.type === "ca" || item.type === "event";
}

/** `sa,ca,ac,e:<eventId>:<ROLE>,c:<organizationId>:<ROLE>`: what the person page is opened with to save the chosen access. */
export function formatGrantParam(items: readonly GrantItem[]): string {
  return items.map(grantKey).join(",");
}

/**
 * Reads `?grant=`. Anything unknown, malformed or repeated is dropped, and at most {@link GRANT_ITEM_CAP} items are
 * kept, so a hand-edited link can only ever ask for a short list of known kinds of access.
 */
export function parseGrantParam(value: unknown): GrantItem[] {
  const text = firstParam(value);
  if (typeof text !== "string") return [];
  const items: GrantItem[] = [];
  const seen = new Set<string>();
  for (const part of text.slice(0, 2000).split(",")) {
    if (items.length >= GRANT_ITEM_CAP) break;
    const [kind, id, role, ...extra] = part.trim().split(":");
    let item: GrantItem | null = null;
    if (extra.length === 0) {
      if ((kind === "sa" || kind === "ca" || kind === "ac") && id === undefined) item = { type: kind };
      else if (kind === "e" && id && idPattern.test(id) && (eventRoles as readonly string[]).includes(role ?? "")) item = { type: "event", eventId: id, role: role as EventRole };
      else if (kind === "c" && id && idPattern.test(id) && (clubRoles as string[]).includes(role ?? "")) item = { type: "club", organizationId: id, role: role as ClubRole };
    }
    if (!item || seen.has(grantKey(item))) continue;
    seen.add(grantKey(item));
    items.push(item);
  }
  return items;
}

/**
 * save: ready. change: the person has a different active role on this event; saving changes it (the memberships route
 * does). other-role: the person has a different role at this club; the club roles route refuses an overlapping role, so
 * it is not saved (revoke the old one first).
 */
export type GrantPlanState = "save" | "change" | "has" | "other-role" | "needs-staff" | "needs-account";
export type GrantPlanRow = { key: string; item: GrantItem; state: GrantPlanState };

/** What the person already has, for marking the chosen items. */
export type GrantPlanPerson = {
  hasStaff: boolean;
  hasAccount: boolean;
  systemAdministrator: boolean;
  clubsAdministrator: boolean;
  areaCoordinator: boolean;
  /** Events with an active membership, with the role. */
  activeEvents: ReadonlyArray<{ eventId: string; role: string }>;
  /** Clubs with a current or scheduled role, with the role. */
  clubRoles: ReadonlyArray<{ organizationId: string; role: string }>;
};

/**
 * The "Chosen in the invite" rows for one viewer. A Clubs Administrator never sees (or saves) staff-side items. An
 * item the person already has is marked so; one that needs a login the person doesn't have is not saveable.
 */
export function planGrantItems(items: readonly GrantItem[], scope: PeopleScope, person: GrantPlanPerson): GrantPlanRow[] {
  const rows: GrantPlanRow[] = [];
  for (const item of items) {
    if (scope === "clubs" && isStaffSideGrant(item)) continue;
    let state: GrantPlanState;
    if (isStaffSideGrant(item) && !person.hasStaff) state = "needs-staff";
    else if (!isStaffSideGrant(item) && !person.hasAccount) state = "needs-account";
    else if (item.type === "sa") state = person.systemAdministrator ? "has" : "save";
    else if (item.type === "ca") state = person.clubsAdministrator ? "has" : "save";
    else if (item.type === "ac") state = person.areaCoordinator ? "has" : "save";
    else if (item.type === "event") {
      const current = person.activeEvents.find((entry) => entry.eventId === item.eventId);
      state = !current ? "save" : current.role === item.role ? "has" : "change";
    } else {
      const current = person.clubRoles.filter((entry) => entry.organizationId === item.organizationId);
      state = current.length === 0 ? "save" : current.some((entry) => entry.role === item.role) ? "has" : "other-role";
    }
    rows.push({ key: grantKey(item), item, state });
  }
  return rows;
}
