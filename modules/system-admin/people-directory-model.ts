/**
 * The pure half of the People & access directory (#1275): merging staff logins and website
 * accounts into one list of people and paging it. No database, so it is unit tested directly.
 */

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
