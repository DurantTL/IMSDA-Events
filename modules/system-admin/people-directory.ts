import "server-only";

import { getPrisma } from "@/lib/prisma";
import {
  buildRoleWhere,
  clubRoleStatus,
  mergePeopleCandidates,
  pagePeople,
  type ClubRoleStatus,
  type PeopleFilters,
  type PeopleScope,
  summarizePeopleAccess,
  type MergedPerson,
  type PeopleCandidate,
} from "@/modules/system-admin/people-directory-model";

/**
 * People & access (#1275): one directory over staff logins (`User`) and website accounts
 * (`AttendeeAccount`). A staff login and the account linked to it (`User.attendeeAccountId`) are one
 * person and one row. Read only; the callers gate on a system administrator or an active Clubs
 * Administrator.
 */

export type SignInChip = { side: "Staff login" | "Website account"; label: string; tone: "green" | "gold" | "coral" };

export type PeopleRow = MergedPerson & {
  kinds: Array<"Staff login" | "Website account">;
  signIn: SignInChip[];
  access: string[];
};

function textFilter(text: string) {
  return text ? { contains: text, mode: "insensitive" as const } : undefined;
}

function staffChip(accountStatus: string, disabled: boolean): SignInChip {
  if (disabled) return { side: "Staff login", label: "Sign-in off", tone: "coral" };
  if (accountStatus === "PENDING_ACTIVATION") return { side: "Staff login", label: "Not activated", tone: "gold" };
  return { side: "Staff login", label: "Active", tone: "green" };
}

function accountChip(status: string, disabled: boolean): SignInChip {
  if (disabled) return { side: "Website account", label: "Sign-in off", tone: "coral" };
  if (status === "PENDING_VERIFICATION") return { side: "Website account", label: "Not verified", tone: "gold" };
  return { side: "Website account", label: "Active", tone: "green" };
}

export function isGrantCurrent(grant: { revokedAt: Date | null; effectiveTo?: Date | null; expiresAt?: Date | null }, now = new Date()) {
  if (grant.revokedAt) return false;
  if (grant.effectiveTo && grant.effectiveTo <= now) return false;
  if (grant.expiresAt && grant.expiresAt <= now) return false;
  return true;
}

/**
 * Every person matching `query` (name or email), merged and sorted. Ids and names only.
 *
 * This loads every match (ids, names, emails) from both tables and merges and pages them in memory, so a linked pair
 * is one row and the page count is exact. That is fine at the conference's size (thousands of rows, a few bytes
 * each). Move to database paging (a SQL union ordered by name) if the two tables grow to hundreds of thousands of
 * rows or a search without a query becomes slow.
 */
export async function findPeople(query: string): Promise<MergedPerson[]> {
  const prisma = getPrisma();
  const text = query.trim().slice(0, 120);
  const [users, accounts] = await Promise.all([
    prisma.user.findMany({
      where: text ? { OR: [{ email: textFilter(text) }, { displayName: textFilter(text) }] } : undefined,
      select: { id: true, email: true, displayName: true, attendeeAccountId: true },
    }),
    prisma.attendeeAccount.findMany({
      where: text ? { OR: [{ email: textFilter(text) }, { displayName: textFilter(text) }] } : undefined,
      select: { id: true, email: true, displayName: true, linkedUser: { select: { id: true } } },
    }),
  ]);
  const staff: PeopleCandidate[] = users.map((user) => ({
    kind: "staff", id: user.id, name: user.displayName, email: user.email, linkedId: user.attendeeAccountId,
  }));
  const website: PeopleCandidate[] = accounts.map((account) => ({
    kind: "account", id: account.id, name: account.displayName, email: account.email, linkedId: account.linkedUser?.id ?? null,
  }));
  return mergePeopleCandidates(staff, website);
}

/**
 * Row details (status and access summary) for one page of people only. For a Clubs Administrator (`clubs`) nothing
 * about sign-in, events or system roles is loaded: only the Area Coordinator status and the count of current roles
 * in CLUB-type organizations.
 */
export async function loadPeopleRows(people: readonly MergedPerson[], scope: PeopleScope = "full", now = new Date()): Promise<PeopleRow[]> {
  const prisma = getPrisma();
  const full = scope === "full";
  const staffIds = full ? people.flatMap((person) => (person.staffId ? [person.staffId] : [])) : [];
  const accountIds = people.flatMap((person) => (person.accountId ? [person.accountId] : []));
  const [users, accounts] = await Promise.all([
    staffIds.length === 0 ? [] : prisma.user.findMany({
      where: { id: { in: staffIds } },
      select: {
        id: true,
        globalRole: true,
        accountStatus: true,
        credential: { select: { disabledAt: true } },
        clubsAdministratorGrant: { select: { revokedAt: true } },
        _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
      },
    }),
    accountIds.length === 0 ? [] : prisma.attendeeAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        status: true,
        disabledAt: true,
        areaCoordinatorGrant: { select: { revokedAt: true, expiresAt: true } },
        clubDirectorGrants: {
          where: full ? undefined : { organization: { type: "CLUB" } },
          select: { revokedAt: true, effectiveFrom: true, effectiveTo: true },
        },
      },
    }),
  ]);
  const userById = new Map(users.map((user) => [user.id, user]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return people.map((person) => {
    const user = person.staffId ? userById.get(person.staffId) : undefined;
    const account = person.accountId ? accountById.get(person.accountId) : undefined;
    const kinds: PeopleRow["kinds"] = [];
    const signIn: SignInChip[] = [];
    if (person.staffId) kinds.push("Staff login");
    if (person.accountId) kinds.push("Website account");
    if (full && user) signIn.push(staffChip(user.accountStatus, Boolean(user.credential?.disabledAt)));
    if (full && account) signIn.push(accountChip(account.status, Boolean(account.disabledAt)));
    return {
      ...person,
      kinds,
      signIn,
      access: summarizePeopleAccess({
        systemAdministrator: full && user?.globalRole === "SYSTEM_ADMIN",
        clubsAdministrator: full && Boolean(user?.clubsAdministratorGrant && !user.clubsAdministratorGrant.revokedAt),
        areaCoordinator: Boolean(account?.areaCoordinatorGrant && isGrantCurrent(account.areaCoordinatorGrant, now)),
        activeEventCount: full ? user?._count.memberships ?? 0 : 0,
        activeClubRoleCount: account ? account.clubDirectorGrants.filter((grant) => clubRoleStatus(grant, now) === "active").length : 0,
      }),
    };
  });
}

/**
 * The people who hold the chosen role right now (#1277), merged and sorted like `findPeople`, with the text search
 * applied inside the role. A role that cannot be listed (no event picked, or not allowed for the scope) is nobody.
 */
export async function findPeopleByRole(
  filters: PeopleFilters,
  query: string,
  scope: PeopleScope,
  now = new Date(),
): Promise<MergedPerson[]> {
  const where = buildRoleWhere(filters, scope, now);
  if (!where) return [];
  const prisma = getPrisma();
  const text = query.trim().slice(0, 120);
  const textWhere = text ? { OR: [{ email: textFilter(text) }, { displayName: textFilter(text) }] } : undefined;
  const combine = (roleWhere: Record<string, unknown>) => (textWhere ? { AND: [roleWhere, textWhere] } : roleWhere);
  const [users, accounts] = await Promise.all([
    where.staff ? prisma.user.findMany({
      where: combine(where.staff),
      select: { id: true, email: true, displayName: true, attendeeAccountId: true },
    }) : [],
    where.account ? prisma.attendeeAccount.findMany({
      where: combine(where.account),
      select: { id: true, email: true, displayName: true, linkedUser: { select: { id: true } } },
    }) : [],
  ]);
  return mergePeopleCandidates(
    users.map((user) => ({ kind: "staff" as const, id: user.id, name: user.displayName, email: user.email, linkedId: user.attendeeAccountId })),
    accounts.map((account) => ({ kind: "account" as const, id: account.id, name: account.displayName, email: account.email, linkedId: account.linkedUser?.id ?? null })),
  );
}

export async function searchPeople(query: string, requestedPage: number, scope: PeopleScope = "full", filters?: PeopleFilters) {
  const matches = filters?.role ? await findPeopleByRole(filters, query, scope) : await findPeople(query);
  const page = pagePeople(matches, requestedPage);
  return { ...page, rows: await loadPeopleRows(page.items, scope) };
}

export type PersonEventRow = {
  membershipId: string;
  eventId: string;
  eventName: string;
  role: string;
  active: boolean;
  healthInformation: boolean;
  finalizeInvoices: boolean;
};

export type PersonClubRow = {
  grantId: string;
  organizationId: string;
  clubName: string;
  role: string;
  /** Only "active" counts as current. */
  status: ClubRoleStatus;
  /** When the role starts, for a scheduled one. */
  effectiveFrom: string;
};

export type PersonDetail = {
  name: string;
  email: string;
  staffEmail: string | null;
  accountEmail: string | null;
  staffId: string | null;
  accountId: string | null;
  systemAdministrator: boolean;
  clubsAdministrator: boolean;
  siteContentEditor: boolean;
  areaCoordinator: boolean;
  staff: null | {
    status: string;
    signInDisabled: boolean;
    displayName: string;
    jobTitle: string;
    phone: string;
    bio: string;
    /** "On", "Pending" or "Not set up". */
    twoStep: string;
    lastSignedInAt: string | null;
  };
  account: null | {
    status: string;
    signInDisabled: boolean;
    emailVerified: boolean;
    twoStep: string;
    lastSignedInAt: string | null;
  };
  /** Null when the viewer may not see event access (a Clubs Administrator). */
  events: PersonEventRow[] | null;
  clubs: PersonClubRow[];
};

/**
 * One person, from either id of a linked pair. `scope: "clubs"` (a Clubs Administrator viewing) loads
 * no event memberships and no sign-in details, and only club-type organizations.
 */
export async function getPersonDetail(
  kind: "staff" | "account",
  id: string,
  scope: "full" | "clubs",
): Promise<PersonDetail | null> {
  const prisma = getPrisma();
  let staffId: string | null = null;
  let accountId: string | null = null;
  if (kind === "staff") {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, attendeeAccountId: true } });
    if (!user) return null;
    staffId = user.id;
    accountId = user.attendeeAccountId;
  } else {
    const account = await prisma.attendeeAccount.findUnique({ where: { id }, select: { id: true, linkedUser: { select: { id: true } } } });
    if (!account) return null;
    accountId = account.id;
    staffId = account.linkedUser?.id ?? null;
  }
  const full = scope === "full";
  const now = new Date();

  const [memberships, user, account] = await Promise.all([
    full && staffId ? prisma.eventMembership.findMany({
      where: { userId: staffId },
      orderBy: { event: { startsAt: "desc" } },
      select: { id: true, role: true, status: true, permissions: true, event: { select: { id: true, name: true } } },
    }) : [],
    staffId ? prisma.user.findUnique({
      where: { id: staffId },
      select: {
        email: true,
        displayName: true,
        jobTitle: true,
        phone: true,
        bio: true,
        globalRole: true,
        accountStatus: true,
        credential: { select: { disabledAt: true } },
        clubsAdministratorGrant: { select: { revokedAt: true } },
        siteContentEditorGrant: { select: { revokedAt: true } },
        mfaEnrollment: { select: { status: true } },
        sessions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
    }) : null,
    accountId ? prisma.attendeeAccount.findUnique({
      where: { id: accountId },
      select: {
        email: true,
        displayName: true,
        status: true,
        disabledAt: true,
        emailVerifiedAt: true,
        areaCoordinatorGrant: { select: { revokedAt: true, expiresAt: true } },
        mfaEnrollment: { select: { status: true } },
        _count: { select: { passkeys: { where: { revokedAt: null } } } },
        sessions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        clubDirectorGrants: {
          where: full ? undefined : { organization: { type: "CLUB" } },
          orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
          select: {
            id: true, role: true, revokedAt: true, effectiveFrom: true, effectiveTo: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    }) : null,
  ]);
  if (!user && !account) return null;

  return {
    name: user?.displayName ?? account?.displayName ?? "",
    email: user?.email ?? account?.email ?? "",
    staffEmail: user?.email ?? null,
    accountEmail: account?.email ?? null,
    staffId: user ? staffId : null,
    accountId: account ? accountId : null,
    systemAdministrator: user?.globalRole === "SYSTEM_ADMIN",
    clubsAdministrator: Boolean(user?.clubsAdministratorGrant && !user.clubsAdministratorGrant.revokedAt),
    siteContentEditor: Boolean(user?.siteContentEditorGrant && !user.siteContentEditorGrant.revokedAt),
    areaCoordinator: Boolean(account?.areaCoordinatorGrant && isGrantCurrent(account.areaCoordinatorGrant, now)),
    staff: full && user ? {
      status: user.accountStatus,
      signInDisabled: Boolean(user.credential?.disabledAt),
      displayName: user.displayName,
      jobTitle: user.jobTitle ?? "",
      phone: user.phone ?? "",
      bio: user.bio ?? "",
      twoStep: user.mfaEnrollment?.status === "ACTIVE" ? "On" : user.mfaEnrollment?.status === "PENDING" ? "Pending" : "Not set up",
      lastSignedInAt: user.sessions[0]?.createdAt.toISOString() ?? null,
    } : null,
    account: full && account ? {
      status: account.status,
      signInDisabled: Boolean(account.disabledAt),
      emailVerified: account.emailVerifiedAt !== null,
      twoStep: account.mfaEnrollment?.status === "ACTIVE" || account._count.passkeys > 0 ? "On" : "Not set up",
      lastSignedInAt: account.sessions[0]?.createdAt.toISOString() ?? null,
    } : null,
    events: full && user
      ? memberships.map((membership) => ({
        membershipId: membership.id,
        eventId: membership.event.id,
        eventName: membership.event.name,
        role: membership.role,
        active: membership.status === "ACTIVE",
        healthInformation: membership.permissions.includes("VIEW_HEALTH_INFORMATION"),
        finalizeInvoices: membership.permissions.includes("FINALIZE_INVOICES"),
      }))
      : full ? [] : null,
    clubs: account
      ? account.clubDirectorGrants.map((grant) => ({
        grantId: grant.id,
        organizationId: grant.organization.id,
        clubName: grant.organization.name,
        role: grant.role,
        status: clubRoleStatus(grant, now),
        effectiveFrom: grant.effectiveFrom.toISOString(),
      }))
      : [],
  };
}

export type EventOption = { id: string; name: string };
export type ClubOption = { id: string; name: string };

/** Events a person can be added to: not archived, newest first. Names only. */
export async function listEventOptions(): Promise<EventOption[]> {
  return getPrisma().event.findMany({
    where: { archivedAt: null },
    orderBy: { startsAt: "desc" },
    take: 300,
    select: { id: true, name: true },
  });
}

/** Active clubs a director role can be given for. CLUB-type only; the route still decides. */
export async function listClubOptions(): Promise<ClubOption[]> {
  return getPrisma().organization.findMany({
    where: { type: "CLUB", isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
