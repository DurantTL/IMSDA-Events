import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { clubInviteSignUpUrl } from "@/modules/club-imports/invites";
import { clubDirectorRoleLabels } from "@/modules/organizations/director-grants-domain";
import type { PeopleScope } from "@/modules/system-admin/people-directory-model";
import { containsAnyOf } from "@/lib/server-search";
import { clampPage } from "@/lib/pagination";

/**
 * Invites still waiting on the person (#1276), for the People & access list and the person page: club role invites made
 * from People & access, Area Coordinator invites, and (full scope only) staff logins that were invited and have not
 * activated. A Clubs Administrator never sees staff logins. Expired invites are listed as expired: they can still be
 * resent or cancelled.
 */

export type PendingInvite = {
  kind: "staff" | "club" | "area";
  id: string;
  name: string;
  email: string;
  /** What the invite is for, in words. */
  what: string;
  sentAt: string | null;
  expired: boolean;
  /** Family-side invites carry no secret, so staff can pass this link on themselves when email isn't set up. */
  signUpUrl?: string;
};

/** Invites per page on People & access. The list is paged in the database from its three sources, so every invite is reachable (#1492). */
export const PENDING_INVITES_PAGE_SIZE = 25;

const clubSelect = { id: true, email: true, name: true, role: true, sentAt: true, createdAt: true, expiresAt: true, organization: { select: { name: true } } } as const;
const areaSelect = { id: true, email: true, name: true, sentAt: true, createdAt: true, expiresAt: true } as const;
const staffSelect = {
  id: true, email: true, displayName: true, createdAt: true,
  resetTokens: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, expiresAt: true, usedAt: true } },
} as const;

type ClubRow = Prisma.ClubInviteGetPayload<{ select: typeof clubSelect }>;
type AreaRow = Prisma.AreaCoordinatorInviteGetPayload<{ select: typeof areaSelect }>;
type StaffRow = Prisma.UserGetPayload<{ select: typeof staffSelect }>;

const fromClub = (invite: ClubRow, now: Date): PendingInvite => ({
  kind: "club",
  id: invite.id,
  name: invite.name,
  email: invite.email,
  what: `${clubDirectorRoleLabels[invite.role]} of ${invite.organization.name}`,
  sentAt: (invite.sentAt ?? invite.createdAt).toISOString(),
  expired: Boolean(invite.expiresAt && invite.expiresAt <= now),
  signUpUrl: clubInviteSignUpUrl(invite.email),
});

const fromArea = (invite: AreaRow, now: Date): PendingInvite => ({
  kind: "area",
  id: invite.id,
  name: invite.name,
  email: invite.email,
  what: "Area Coordinator",
  sentAt: (invite.sentAt ?? invite.createdAt).toISOString(),
  expired: Boolean(invite.expiresAt && invite.expiresAt <= now),
  signUpUrl: clubInviteSignUpUrl(invite.email),
});

const fromStaff = (user: StaffRow, now: Date): PendingInvite => {
  const token = user.resetTokens[0];
  return {
    kind: "staff",
    id: user.id,
    name: user.displayName,
    email: user.email,
    what: "Staff login, not activated yet",
    sentAt: (token?.createdAt ?? user.createdAt).toISOString(),
    expired: !token || Boolean(token.usedAt) || token.expiresAt <= now,
  };
};

/**
 * Newest first, then the id, then the kind. The ties are broken on fields the database and this comparison order the same way
 * (a timestamp and a plain-code-unit id, never a locale-collated name or email), so a page boundary never skips or repeats a row.
 */
export function comparePendingInvites(a: PendingInvite, b: PendingInvite): number {
  const sentA = a.sentAt ?? "";
  const sentB = b.sentAt ?? "";
  if (sentA !== sentB) return sentA < sentB ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
}

type PendingOptions = { query?: string; emails?: readonly string[]; scope: PeopleScope };

/** The three sources' where-clauses. Every scope rule lives here: who may see staff logins, which clubs, which statuses. */
function pendingWheres(options: PendingOptions) {
  const emails = options.emails?.map((email) => email.trim().toLowerCase()).filter(Boolean);
  const text = options.query?.trim().slice(0, 120) ?? "";
  const match = () => ({
    ...(emails ? { email: { in: emails } } : {}),
    ...(text ? containsAnyOf(["email", "name"], text) : {}),
  });
  const userMatch: Prisma.UserWhereInput = {
    ...(emails ? { email: { in: emails } } : {}),
    ...(text ? containsAnyOf(["email", "displayName"], text) : {}),
  };
  const open = { status: { in: ["PENDING", "SENT"] as Array<"PENDING" | "SENT"> } };
  return {
    emptyEmails: Boolean(emails && emails.length === 0),
    club: { ...open, source: "PEOPLE", organization: { type: "CLUB" }, ...match() } as Prisma.ClubInviteWhereInput,
    area: { ...open, ...match() } as Prisma.AreaCoordinatorInviteWhereInput,
    // Staff logins are for the full scope only: a Clubs Administrator never reads them.
    staff: options.scope === "full"
      ? { ...userMatch, accountStatus: "PENDING_ACTIVATION", credential: { is: { disabledAt: null } } } as Prisma.UserWhereInput
      : null,
  };
}

/** Every pending invite that matches (a person's own page asks by their emails, so this list is short). */
export async function listPendingInvites(
  options: PendingOptions,
  now = new Date(),
): Promise<{ invites: PendingInvite[]; emailConfigured: boolean }> {
  const emailConfigured = isAccountEmailConfigured();
  const where = pendingWheres(options);
  if (where.emptyEmails) return { invites: [], emailConfigured };
  const prisma = getPrisma();
  const [clubInvites, areaInvites, staff] = await Promise.all([
    prisma.clubInvite.findMany({ where: where.club, orderBy: { createdAt: "desc" }, select: clubSelect }),
    prisma.areaCoordinatorInvite.findMany({ where: where.area, orderBy: { createdAt: "desc" }, select: areaSelect }),
    where.staff ? prisma.user.findMany({ where: where.staff, orderBy: { createdAt: "desc" }, select: staffSelect }) : [],
  ]);
  const invites = [
    ...clubInvites.map((invite) => fromClub(invite, now)),
    ...areaInvites.map((invite) => fromArea(invite, now)),
    ...staff.map((user) => fromStaff(user, now)),
  ].sort(comparePendingInvites);
  return { invites, emailConfigured };
}

/**
 * One page of the merged list for People & access, with the true total (#1492). The three sources are counted in the
 * database. A page needs the newest `skip + pageSize` of each source: club and Area Coordinator invites are read in the
 * database in sent-date order (sent ones by `sentAt`, unsent ones by `createdAt`, which is what a row's date falls back to), and
 * the three are merged with `comparePendingInvites` and cut to the page. Staff logins not yet activated have a date that comes from their
 * latest setup link, which the database cannot order by, so that source is read whole; it is the short one.
 */
export async function listPendingInvitesPage(
  options: PendingOptions,
  requestedPage = 1,
  now = new Date(),
): Promise<{ invites: PendingInvite[]; emailConfigured: boolean; total: number; page: number; pageSize: number }> {
  const emailConfigured = isAccountEmailConfigured();
  const pageSize = PENDING_INVITES_PAGE_SIZE;
  const where = pendingWheres(options);
  if (where.emptyEmails) return { invites: [], emailConfigured, total: 0, page: 1, pageSize };
  const prisma = getPrisma();
  const [clubCount, areaCount, staff] = await Promise.all([
    prisma.clubInvite.count({ where: where.club }),
    prisma.areaCoordinatorInvite.count({ where: where.area }),
    where.staff ? prisma.user.findMany({ where: where.staff, select: staffSelect }) : [],
  ]);
  const total = clubCount + areaCount + staff.length;
  const page = clampPage(requestedPage, total, pageSize);
  const skip = (page - 1) * pageSize;
  const wanted = skip + pageSize;
  const [clubSent, clubUnsent, areaSent, areaUnsent] = await Promise.all([
    clubCount > 0 ? prisma.clubInvite.findMany({ where: { AND: [where.club, { sentAt: { not: null } }] }, orderBy: [{ sentAt: "desc" }, { id: "asc" }], take: wanted, select: clubSelect }) : [],
    clubCount > 0 ? prisma.clubInvite.findMany({ where: { AND: [where.club, { sentAt: null }] }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: wanted, select: clubSelect }) : [],
    areaCount > 0 ? prisma.areaCoordinatorInvite.findMany({ where: { AND: [where.area, { sentAt: { not: null } }] }, orderBy: [{ sentAt: "desc" }, { id: "asc" }], take: wanted, select: areaSelect }) : [],
    areaCount > 0 ? prisma.areaCoordinatorInvite.findMany({ where: { AND: [where.area, { sentAt: null }] }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: wanted, select: areaSelect }) : [],
  ]);
  const merged = [
    ...[...clubSent, ...clubUnsent].map((invite) => fromClub(invite, now)),
    ...[...areaSent, ...areaUnsent].map((invite) => fromArea(invite, now)),
    ...staff.map((user) => fromStaff(user, now)),
  ].sort(comparePendingInvites);
  return { invites: merged.slice(skip, wanted), emailConfigured, total, page, pageSize };
}
