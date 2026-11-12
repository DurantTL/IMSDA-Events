import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { containsAnyOf, everyTermMatches, insensitiveContains } from "@/lib/server-search";
import { hasActiveClubsAdministratorGrant, clubsAdministratorPermissions } from "@/modules/access/club-event-access";
import { eventPermissions, isKitchenWithoutEventView, kitchenCountsPath, rolePermissions, type EventPermission } from "@/modules/access/permissions";
import { eventAccessFilter } from "@/modules/events/repository";
import { clubPeopleWhere, mergePeopleCandidates, type PeopleCandidate } from "@/modules/system-admin/people-directory-model";
import {
  STAFF_SEARCH_GROUP_LIMIT,
  cleanStaffSearchQuery,
  emptyStaffSearchResult,
  staffChurchHref,
  staffClubHref,
  staffPersonHref,
  staffSearchSeeAllHref,
  staffSearchTerms,
  yearRange,
  type StaffSearchGroup,
  type StaffSearchPerson,
  type StaffSearchResult,
} from "@/modules/staff-search/domain";

/**
 * Staff record search (#1837): clubs, events, churches and people for the header search box.
 *
 * Each group applies the permission of the page its result opens, on the server and inside the query, so a record the
 * viewer may not open is never read, let alone sent:
 * - Clubs: the staff club page opens for a system administrator or an active Clubs Administrator (`hasClubsAdministration`).
 * - Events: the same filter the event lists use (`eventAccessFilter`): everything for a system administrator, else the
 *   events the account has an active assignment on, plus club events for an active Clubs Administrator. Archived events
 *   and the hidden billing container are left out. The link is the one `resolveEventContext` would open for that
 *   account: the event overview, or Kitchen counts for kitchen staff, who lack the event view.
 * - Churches: every church page and the Clubs and churches directory are for system administrators only, so only they
 *   get churches, and the link is that directory filtered to the church.
 * - People (#1854): the rule of People & access (`resolvePeopleViewer`). A system administrator searches every staff login
 *   and website account; an active Clubs Administrator only club people (`clubPeopleWhere`, put inside the query for both
 *   tables, as `findPeople` does). Anyone else gets an empty group and no people query is run. A staff login and its linked
 *   website account are one row. Only the name (the email when there is none), the kind and the link are returned.
 *
 * Only the fields shown are selected. A club's director name is used to match and is never selected.
 */

type Viewer = { id: string; globalRole?: string | null };

const take = STAFF_SEARCH_GROUP_LIMIT + 1;

function group<T>(rows: T[], seeAllHref: string | null): StaffSearchGroup<T> {
  const more = rows.length > STAFF_SEARCH_GROUP_LIMIT;
  return { items: rows.slice(0, STAFF_SEARCH_GROUP_LIMIT), more, seeAllHref: more ? seeAllHref : null };
}

function clubTermMatches(term: string, now: Date): Prisma.OrganizationWhereInput {
  const contains = insensitiveContains(term);
  return {
    OR: [
      { name: contains },
      { city: contains },
      { parentOrganization: { is: { name: contains } } },
      {
        // The club's current director, by name. Used to match only.
        directorGrants: {
          some: {
            role: "DIRECTOR",
            revokedAt: null,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            attendeeAccount: { OR: [{ displayName: contains }, { firstName: contains }, { lastName: contains }] },
          },
        },
      },
    ],
  };
}

function eventTermMatches(term: string): Prisma.EventWhereInput {
  const year = yearRange(term);
  return { OR: [{ name: insensitiveContains(term) }, ...(year ? [{ startsAt: year }] : [])] };
}

function churchTermMatches(term: string): Prisma.OrganizationWhereInput {
  const contains = insensitiveContains(term);
  return { OR: [{ name: contains }, { city: contains }] };
}

function personTermMatches(term: string) {
  return containsAnyOf(["displayName", "email"], term);
}

/** People for the box: both tables read under the viewer's filter, linked pairs merged, cut to the limit. */
async function findPeopleForSearch(terms: string[], scope: "full" | "clubs", now: Date, seeAllHref: string | null): Promise<StaffSearchGroup<StaffSearchPerson>> {
  const prisma = getPrisma();
  const club = scope === "full" ? null : clubPeopleWhere(now);
  const text = everyTermMatches(terms, personTermMatches);
  const within = (clubWhere: object | undefined) => (clubWhere ? { AND: [clubWhere, text] } : text);
  const orderBy = [{ displayName: "asc" as const }, { email: "asc" as const }];
  const [users, accounts] = await Promise.all([
    prisma.user.findMany({
      where: within(club?.staff),
      orderBy,
      take,
      select: { id: true, email: true, displayName: true, attendeeAccountId: true },
    }),
    prisma.attendeeAccount.findMany({
      where: within(club?.account),
      orderBy,
      take,
      select: { id: true, email: true, displayName: true, linkedUser: { select: { id: true } } },
    }),
  ]);
  const staff: PeopleCandidate[] = users.map((user) => ({ kind: "staff", id: user.id, name: user.displayName, email: user.email, linkedId: user.attendeeAccountId }));
  const website: PeopleCandidate[] = accounts.map((account) => ({ kind: "account", id: account.id, name: account.displayName, email: account.email, linkedId: account.linkedUser?.id ?? null }));
  const people = mergePeopleCandidates(staff, website).map((person): StaffSearchPerson => ({
    id: person.staffId ?? person.accountId ?? person.key,
    name: person.name.trim() || person.email,
    kind: person.staffId && person.accountId ? "Staff login and website account" : person.staffId ? "Staff login" : "Website account",
    href: staffPersonHref(person),
  }));
  return group(people, seeAllHref);
}

/** The permissions this account holds on an event, as `resolveEventContext` computes them. */
function permissionsOnEvent(input: {
  systemAdmin: boolean;
  clubsAdministrator: boolean;
  audience: string;
  membership: { role: keyof typeof rolePermissions; status: string; permissions: readonly EventPermission[] } | null;
}): EventPermission[] {
  if (input.systemAdmin) return [...eventPermissions];
  const active = input.membership?.status === "ACTIVE" ? input.membership : null;
  const extra = active?.permissions ?? [];
  if (input.clubsAdministrator && input.audience === "CLUB") return clubsAdministratorPermissions(extra);
  return active ? [...new Set([...rolePermissions[active.role], ...extra])] : [];
}

export async function searchStaffRecords(user: Viewer, rawQuery: string | null | undefined, now = new Date()): Promise<StaffSearchResult> {
  const query = cleanStaffSearchQuery(rawQuery);
  const terms = staffSearchTerms(query);
  if (terms.length === 0) return emptyStaffSearchResult();

  const prisma = getPrisma();
  const systemAdmin = user.globalRole === "SYSTEM_ADMIN";
  const clubsAdministrator = await hasActiveClubsAdministratorGrant(user.id);
  const clubsAdministration = systemAdmin || clubsAdministrator;
  const seeAll = (key: "clubs" | "events" | "churches") => staffSearchSeeAllHref({ group: key, query, systemAdmin, clubsAdministration });

  const peopleScope = systemAdmin ? "full" : clubsAdministrator ? "clubs" : null;
  const [clubs, events, churches, people] = await Promise.all([
    clubsAdministration
      ? prisma.organization.findMany({
        where: { type: "CLUB", ...everyTermMatches(terms, (term) => clubTermMatches(term, now)) },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        take,
        select: { id: true, name: true, city: true, isActive: true, parentOrganization: { select: { name: true } } },
      })
      : Promise.resolve([]),
    // `eventAccessFilter` is the one rule the event lists use; an account with no access gets a filter that matches nothing it holds.
    eventAccessFilter(user.id, systemAdmin, "include").then((access) => prisma.event.findMany({
      where: { AND: [access, { archivedAt: null, isBillingContainer: false }, ...terms.map(eventTermMatches)] },
      orderBy: [{ startsAt: "desc" }, { name: "asc" }],
      take,
      select: {
        id: true,
        name: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        audience: true,
        memberships: { where: { userId: user.id }, select: { role: true, status: true, permissions: true } },
      },
    })),
    systemAdmin
      ? prisma.organization.findMany({
        where: { type: "CHURCH", ...everyTermMatches(terms, churchTermMatches) },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        take,
        select: { id: true, name: true, city: true },
      })
      : Promise.resolve([]),
    // No people query at all for anyone who has no People & access.
    peopleScope ? findPeopleForSearch(terms, peopleScope, now, staffSearchSeeAllHref({ group: "people", query, systemAdmin, clubsAdministration })) : Promise.resolve(group<StaffSearchPerson>([], null)),
  ]);

  const eventRows = events.flatMap((event) => {
    const permissions = permissionsOnEvent({ systemAdmin, clubsAdministrator, audience: event.audience, membership: event.memberships[0] ?? null });
    const id = encodeURIComponent(event.id);
    const href = permissions.includes("VIEW_EVENT")
      ? `/overview?event=${id}`
      : isKitchenWithoutEventView(permissions) ? `${kitchenCountsPath}?event=${id}` : null;
    return href
      ? [{ id: event.id, name: event.name, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(), timezone: event.timezone, href }]
      : [];
  });

  return {
    query,
    clubs: group(clubs.map((club) => ({ id: club.id, name: club.name, city: club.city, sponsoringChurch: club.parentOrganization?.name ?? null, isActive: club.isActive, href: staffClubHref(club.id) })), seeAll("clubs")),
    events: group(eventRows, seeAll("events")),
    churches: group(churches.map((church) => ({ id: church.id, name: church.name, city: church.city, href: staffChurchHref(church.name) })), seeAll("churches")),
    people,
  };
}
