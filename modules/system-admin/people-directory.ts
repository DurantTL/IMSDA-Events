import "server-only";

import { getPrisma } from "@/lib/prisma";
import {
  mergePeopleCandidates,
  pagePeople,
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

/** Every person matching `query` (name or email), merged and sorted. Ids and names only. */
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

/** Row details (status and access summary) for one page of people only. */
export async function loadPeopleRows(people: readonly MergedPerson[], now = new Date()): Promise<PeopleRow[]> {
  const prisma = getPrisma();
  const staffIds = people.flatMap((person) => (person.staffId ? [person.staffId] : []));
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
        clubDirectorGrants: { select: { revokedAt: true, effectiveTo: true } },
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
    if (user) {
      kinds.push("Staff login");
      signIn.push(staffChip(user.accountStatus, Boolean(user.credential?.disabledAt)));
    }
    if (account) {
      kinds.push("Website account");
      signIn.push(accountChip(account.status, Boolean(account.disabledAt)));
    }
    return {
      ...person,
      kinds,
      signIn,
      access: summarizePeopleAccess({
        systemAdministrator: user?.globalRole === "SYSTEM_ADMIN",
        clubsAdministrator: Boolean(user?.clubsAdministratorGrant && !user.clubsAdministratorGrant.revokedAt),
        areaCoordinator: Boolean(account?.areaCoordinatorGrant && isGrantCurrent(account.areaCoordinatorGrant, now)),
        activeEventCount: user?._count.memberships ?? 0,
        activeClubRoleCount: account ? account.clubDirectorGrants.filter((grant) => isGrantCurrent(grant, now)).length : 0,
      }),
    };
  });
}

export async function searchPeople(query: string, requestedPage: number) {
  const matches = await findPeople(query);
  const page = pagePeople(matches, requestedPage);
  return { ...page, rows: await loadPeopleRows(page.items) };
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
  active: boolean;
};

export type PersonDetail = {
  name: string;
  email: string;
  staffId: string | null;
  accountId: string | null;
  systemAdministrator: boolean;
  clubsAdministrator: boolean;
  areaCoordinator: boolean;
  staff: null | {
    status: string;
    signInDisabled: boolean;
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
        globalRole: true,
        accountStatus: true,
        credential: { select: { disabledAt: true } },
        clubsAdministratorGrant: { select: { revokedAt: true } },
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
            id: true, role: true, revokedAt: true, effectiveTo: true,
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
    staffId: user ? staffId : null,
    accountId: account ? accountId : null,
    systemAdministrator: user?.globalRole === "SYSTEM_ADMIN",
    clubsAdministrator: Boolean(user?.clubsAdministratorGrant && !user.clubsAdministratorGrant.revokedAt),
    areaCoordinator: Boolean(account?.areaCoordinatorGrant && isGrantCurrent(account.areaCoordinatorGrant, now)),
    staff: full && user ? {
      status: user.accountStatus,
      signInDisabled: Boolean(user.credential?.disabledAt),
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
        active: isGrantCurrent(grant, now),
      }))
      : [],
  };
}
