import "server-only";

import { getPrisma } from "@/lib/prisma";
import { everyTermMatches, insensitiveContains } from "@/lib/server-search";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { getClubRoleAccess, getRosterAccessState } from "@/modules/club-rosters/access";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";
import {
  CLUB_SEARCH_GROUP_LIMIT,
  cleanClubSearchQuery,
  clubPortalHref,
  clubRosterSearchHref,
  clubSearchTerms,
  emptyClubSearchResult,
  everyTermInAnyField,
  memberDisplayName,
  type ClubSearchClub,
  type ClubSearchMember,
  type ClubSearchResult,
} from "@/modules/club-search/domain";

/**
 * Club portal search (#1854): the leader's own clubs and the members of the clubs whose roster is open to them.
 *
 * Who asks: an attendee account (its clubs are `listDirectedClubs`), or a staff act-as as a club director (only that one
 * club). Anyone else has no club identity and the route answers 401.
 *
 * Each group applies the permission of the page its result opens, on the server:
 * - Clubs: a club is listed only where `getClubRoleAccess` is OK, so a pending second step, a sign-in that is not the
 *   person's own, or a club the account holds no current role in gives nothing.
 * - Members: only from a club where `getRosterAccessState` is OPEN, exactly the roster page's gate (the roster
 *   capability, so never a reporter; the person's own session; the authenticator unlock within 12 hours). For any other
 *   club no member query is made at all. The query selects only the id and the first and last name, for the current club
 *   year and the roster's own status filter, so birth dates, ages, contacts, guardians, health and school details are never read.
 *
 * Nothing here grants access: each page still checks on the server when the link is opened.
 */

export type ClubSearchViewer =
  | { kind: "ATTENDEE"; accountId: string }
  | { kind: "ACTING"; actAsId: string; organizationId: string };

/** The club identity behind this request, or null when there is none (the route answers 401). A club act-as comes first, as in the access functions. */
export async function getClubSearchViewer(): Promise<ClubSearchViewer | null> {
  const acting = await currentStaffActingContext();
  if (acting && acting.role === "CLUB_DIRECTOR" && acting.organizationId) {
    return { kind: "ACTING", actAsId: acting.actAsId, organizationId: acting.organizationId };
  }
  const { account } = await getCurrentAttendee();
  return account ? { kind: "ATTENDEE", accountId: account.id } : null;
}

/** The key the rate limit counts requests under. */
export const clubSearchRateLimitKey = (viewer: ClubSearchViewer) => (viewer.kind === "ACTING" ? `act-as:${viewer.actAsId}` : `account:${viewer.accountId}`);

/** A leader holds a handful of clubs; this only bounds a pathological account. */
const MAX_CLUBS = 20;
const take = CLUB_SEARCH_GROUP_LIMIT + 1;

function group<T>(rows: T[], seeAllHref: string | null, moreRead = false) {
  const more = moreRead || rows.length > CLUB_SEARCH_GROUP_LIMIT;
  return { items: rows.slice(0, CLUB_SEARCH_GROUP_LIMIT), more, seeAllHref: more ? seeAllHref : null };
}

export async function searchClubPortal(viewer: ClubSearchViewer, rawQuery: string | null | undefined, now = new Date()): Promise<ClubSearchResult> {
  const query = cleanClubSearchQuery(rawQuery);
  const terms = clubSearchTerms(query);
  if (terms.length === 0) return emptyClubSearchResult();

  const candidateIds = viewer.kind === "ACTING"
    ? [viewer.organizationId]
    : (await listDirectedClubs(viewer.accountId, now)).slice(0, MAX_CLUBS).map((club) => club.organizationId);

  const accesses = await Promise.all(candidateIds.map((id) => getClubRoleAccess(id, now)));
  const clubs = accesses.flatMap((access) => (access.state === "OK" ? [{ ...access.club, roster: access.capabilities.roster }] : []));
  if (clubs.length === 0) return emptyClubSearchResult(query);

  const clubRows: ClubSearchClub[] = clubs
    .filter((club) => everyTermInAnyField(terms, [club.name, club.sponsoringChurch]))
    .sort((a, b) => a.name.localeCompare(b.name) || a.organizationId.localeCompare(b.organizationId))
    .map((club) => ({ id: club.organizationId, name: club.name, sponsoringChurch: club.sponsoringChurch, href: clubPortalHref(club.organizationId) }));

  // Members: only where the roster page itself would open. A role with no roster is not even asked.
  const rosterStates = await Promise.all(clubs.map(async (club) => (club.roster ? { club, state: (await getRosterAccessState(club.organizationId, now)).state } : { club, state: "NO_ROSTER" as const })));
  const openClubs = rosterStates.filter((entry) => entry.state === "OPEN").map((entry) => entry.club);

  const members = openClubs.length === 0 ? { rows: [], more: false } : await findMembers(openClubs, terms, clubs.length > 1, clubYearFor(now));
  const onlyClub = openClubs.length === 1 ? openClubs[0]! : null;

  return {
    query,
    clubs: group(clubRows, null),
    // "More" counts the rows read, before same-name rows are joined, so a joined pair never hides that more people match.
    members: group(members.rows, onlyClub ? clubRosterSearchHref(onlyClub.organizationId, query) : null, members.more),
  };
}

async function findMembers(openClubs: { organizationId: string; name: string }[], terms: string[], labelClub: boolean, clubYear: string): Promise<{ rows: ClubSearchMember[]; more: boolean }> {
  const names = new Map(openClubs.map((club) => [club.organizationId, club.name]));
  const rows = await getPrisma().clubRosterMember.findMany({
    where: {
      organizationId: { in: [...names.keys()] },
      clubYear,
      status: { not: "REMOVED" },
      person: {
        is: everyTermMatches(terms, (term) => {
          const contains = insensitiveContains(term);
          return { OR: [{ firstName: contains }, { lastName: contains }] };
        }),
      },
    },
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }, { id: "asc" }],
    take,
    select: { organizationId: true, person: { select: { firstName: true, lastName: true } } },
  });
  // Two people with the same name in one club open the same roster search, so they are one row (keys and arrow keys stay unique).
  const seen = new Set<string>();
  const joined = rows.flatMap((row) => {
    if (!row.person) return [];
    const name = memberDisplayName(row.person);
    const href = clubRosterSearchHref(row.organizationId, name);
    if (seen.has(href)) return [];
    seen.add(href);
    return [{ name, club: labelClub ? names.get(row.organizationId) ?? null : null, href }];
  });
  return { rows: joined, more: rows.length > CLUB_SEARCH_GROUP_LIMIT };
}
