/**
 * The pure half of the People & access directory (#1275): merging staff logins and website
 * accounts into one list of people and paging it. No database, so it is unit tested directly.
 */

import { eventRoles, type EventRole } from "@/modules/access/permissions";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";

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
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const wanted = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const page = Math.min(pageCount, Math.max(1, wanted));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageCount, total: items.length, pageSize };
}

/** Reads `?page=` as a positive integer; anything else is page 1. */
export function parsePeoplePage(value: unknown): number {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string" || !/^\d{1,6}$/.test(text)) return 1;
  return Math.max(1, Number(text));
}

/** Reads `?q=` trimmed and capped. */
export function parsePeopleQuery(value: unknown): string {
  const text = Array.isArray(value) ? value[0] : value;
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
  if (input.systemAdministrator) parts.push("System administrator");
  if (input.clubsAdministrator) parts.push("Clubs Administrator");
  if (input.areaCoordinator) parts.push("Area Coordinator");
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
  const text = Array.isArray(value) ? value[0] : value;
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

export type GrantPlanState = "save" | "has" | "needs-staff" | "needs-account";
export type GrantPlanRow = { key: string; item: GrantItem; state: GrantPlanState };

/** What the person already has, for marking the chosen items. */
export type GrantPlanPerson = {
  hasStaff: boolean;
  hasAccount: boolean;
  systemAdministrator: boolean;
  clubsAdministrator: boolean;
  areaCoordinator: boolean;
  /** Events with an active membership, whatever the role. */
  activeEventIds: readonly string[];
  /** Clubs with a current or scheduled role, whatever the role. */
  clubOrganizationIds: readonly string[];
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
    else if (item.type === "event") state = person.activeEventIds.includes(item.eventId) ? "has" : "save";
    else state = person.clubOrganizationIds.includes(item.organizationId) ? "has" : "save";
    rows.push({ key: grantKey(item), item, state });
  }
  return rows;
}
