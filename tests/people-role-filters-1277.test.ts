import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1277: "who has this role" filters, Club leaders, and the links between levels. Synthetic data only. */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  accountFindMany: vi.fn(),
  inviteFindMany: vi.fn(),
  grantFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    user: { findMany: mocks.userFindMany },
    attendeeAccount: { findMany: mocks.accountFindMany },
    clubInvite: { findMany: mocks.inviteFindMany },
    clubDirectorGrant: { findMany: mocks.grantFindMany },
  }),
}));

import { ClubLeadersList } from "@/components/club-leaders-list";
import { PeopleDirectory } from "@/components/people-directory";
import { clubsAdminTabs } from "@/modules/club-reports/clubs-admin-home-model";
import { listClubLeaders } from "@/modules/system-admin/club-leaders";
import { buildLeadersWhere, parseLeaderFilters, sortClubLeaders } from "@/modules/system-admin/club-leaders-model";
import { findPeopleByRole } from "@/modules/system-admin/people-directory";
import {
  buildRoleWhere,
  needsEventPick,
  parsePeopleFilters,
  parsePeopleRole,
  peopleHref,
  peopleRoleOptions,
  type PeopleFilters,
} from "@/modules/system-admin/people-directory-model";
import { clubTeamPeopleLinkAllowed } from "@/modules/system-admin/people-links";
import { listPendingPeople } from "@/modules/system-admin/pending-people";

const now = new Date("2026-10-27T12:00:00.000Z");
const none = { role: null, eventId: null, clubId: null } satisfies PeopleFilters;
const filtersFor = (role: string, extra: { event?: string; club?: string } = {}, scope: "full" | "clubs" = "full") => parsePeopleFilters({ role, ...extra }, scope);

describe("role parameter parsing", () => {
  it("reads every role key for a system administrator", () => {
    for (const key of ["system-admin", "clubs-admin", "area-coordinator", "pending", "event-event-admin", "event-check-in-staff", "event-kitchen-staff", "club-director", "club-reporter"]) {
      expect(parsePeopleRole(key, "full"), key).not.toBeNull();
    }
    expect(parsePeopleRole("event-check-in-staff", "full")).toEqual({ kind: "event", role: "CHECK_IN_STAFF" });
    expect(parsePeopleRole("club-deputy", "full")).toEqual({ kind: "club", role: "DEPUTY" });
  });

  it("ignores unknown values, and system and event roles for a Clubs Administrator", () => {
    expect(parsePeopleRole("nonsense", "full")).toBeNull();
    expect(parsePeopleRole(undefined, "full")).toBeNull();
    for (const key of ["system-admin", "clubs-admin", "event-event-admin", "event-finance-manager"]) expect(parsePeopleRole(key, "clubs"), key).toBeNull();
    for (const key of ["area-coordinator", "club-director", "club-registrar", "pending"]) expect(parsePeopleRole(key, "clubs"), key).not.toBeNull();
  });

  it("offers a Clubs Administrator only Area Coordinator, club roles and invites", () => {
    const keys = peopleRoleOptions("clubs").flatMap((group) => group.options.map((option) => option.key));
    expect(keys).toEqual(["area-coordinator", "club-director", "club-deputy", "club-registrar", "club-reporter", "pending"]);
    expect(peopleRoleOptions("full").map((group) => group.label)).toEqual(["System", "Event", "Club", "Invites"]);
  });

  it("keeps the event only for an event role and the club only for a club role, and drops odd ids", () => {
    expect(filtersFor("event-event-admin", { event: "evt_1", club: "org_1" })).toMatchObject({ eventId: "evt_1", clubId: null });
    expect(filtersFor("club-director", { event: "evt_1", club: "org_1" })).toMatchObject({ eventId: null, clubId: "org_1" });
    expect(filtersFor("club-director", { club: "a b;c" }).clubId).toBeNull();
    expect(needsEventPick(filtersFor("event-event-admin"))).toBe(true);
    expect(needsEventPick(filtersFor("event-event-admin", { event: "evt_1" }))).toBe(false);
  });

  it("keeps search, filters and page in the link", () => {
    expect(peopleHref({})).toBe("/admin/people");
    expect(peopleHref({ query: "sam", page: 3, filters: filtersFor("event-check-in-staff", { event: "evt_1" }) }))
      .toBe("/admin/people?q=sam&role=event-check-in-staff&event=evt_1&page=3");
    expect(peopleHref({ filters: none, page: 1 })).toBe("/admin/people");
  });
});

describe("role where-clauses", () => {
  it("system administrator and Clubs Administrator read the staff side", () => {
    expect(buildRoleWhere(filtersFor("system-admin"), "full", now)).toEqual({ staff: { globalRole: "SYSTEM_ADMIN" } });
    expect(buildRoleWhere(filtersFor("clubs-admin"), "full", now)).toEqual({ staff: { clubsAdministratorGrant: { is: { revokedAt: null } } } });
  });

  it("Area Coordinator is current: not revoked, not expired", () => {
    expect(buildRoleWhere(filtersFor("area-coordinator"), "clubs", now)).toEqual({
      account: { areaCoordinatorGrant: { is: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } },
    });
  });

  it("an event role needs an event and is an ACTIVE membership in it", () => {
    expect(buildRoleWhere(filtersFor("event-event-admin"), "full", now)).toBeNull();
    expect(buildRoleWhere(filtersFor("event-finance-manager", { event: "evt_1" }), "full", now)).toEqual({
      staff: { memberships: { some: { role: "FINANCE_MANAGER", status: "ACTIVE", eventId: "evt_1" } } },
    });
  });

  it("a club role is a current grant; a Clubs Administrator only gets CLUB-type organizations", () => {
    const grant = (where: ReturnType<typeof buildRoleWhere>) => (where?.account as { clubDirectorGrants: { some: Record<string, unknown> } }).clubDirectorGrants.some;
    const full = grant(buildRoleWhere(filtersFor("club-deputy", { club: "org_1" }), "full", now));
    expect(full).toMatchObject({ role: "DEPUTY", revokedAt: null, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }], organization: { id: "org_1" } });
    expect(full.organization).not.toHaveProperty("type");
    const clubs = grant(buildRoleWhere(filtersFor("club-deputy", { club: "org_1" }, "clubs"), "clubs", now));
    expect(clubs.organization).toEqual({ type: "CLUB", id: "org_1" });
    expect(grant(buildRoleWhere(filtersFor("club-director", {}, "clubs"), "clubs", now)).organization).toEqual({ type: "CLUB" });
  });

  it("builds nothing for a system or event role asked by a Clubs Administrator, or for pending", () => {
    const forged: PeopleFilters = { role: { kind: "system-admin" }, eventId: null, clubId: null };
    expect(buildRoleWhere(forged, "clubs", now)).toBeNull();
    expect(buildRoleWhere({ role: { kind: "event", role: "EVENT_ADMIN" }, eventId: "evt_1", clubId: null }, "clubs", now)).toBeNull();
    expect(buildRoleWhere(filtersFor("pending"), "full", now)).toBeNull();
    expect(buildRoleWhere(none, "full", now)).toBeNull();
  });
});

describe("findPeopleByRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges a linked pair into one person and applies the search inside the role", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "u1", email: "sam@example.test", displayName: "Sam Sample", attendeeAccountId: "a1" }]);
    mocks.accountFindMany.mockResolvedValue([]);
    const people = await findPeopleByRole(filtersFor("system-admin"), "sam", "full", now);
    expect(people).toEqual([{ key: "u1", staffId: "u1", accountId: "a1", name: "Sam Sample", email: "sam@example.test" }]);
    expect(mocks.accountFindMany).not.toHaveBeenCalled();
    expect(mocks.userFindMany.mock.calls[0][0].where).toEqual({
      AND: [{ globalRole: "SYSTEM_ADMIN" }, { OR: [{ email: { contains: "sam", mode: "insensitive" } }, { displayName: { contains: "sam", mode: "insensitive" } }] }],
    });
  });

  it("returns an account-only person for a club role, one row when the account is linked to staff", async () => {
    mocks.accountFindMany.mockResolvedValue([
      { id: "a1", email: "dir@example.test", displayName: "Dee Director", linkedUser: { id: "u9" } },
      { id: "a2", email: "dep@example.test", displayName: "Dan Deputy", linkedUser: null },
    ]);
    const people = await findPeopleByRole(filtersFor("club-director", {}, "clubs"), "", "clubs", now);
    expect(people.map((person) => [person.staffId, person.accountId])).toEqual([[null, "a2"], ["u9", "a1"]]);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });

  it("lists nobody for an event role with no event, and for a Clubs Administrator forging a system role", async () => {
    expect(await findPeopleByRole(filtersFor("event-event-admin"), "", "full", now)).toEqual([]);
    expect(await findPeopleByRole({ role: { kind: "system-admin" }, eventId: null, clubId: null }, "", "clubs", now)).toEqual([]);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.accountFindMany).not.toHaveBeenCalled();
  });
});

describe("pending invites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows open CLUB invites to both scopes and unactivated staff logins to a system administrator only", async () => {
    mocks.inviteFindMany.mockResolvedValue([{ id: "i1", email: "new@example.test", name: "Nia New", role: "DIRECTOR", organization: { name: "Synthetic Club" } }]);
    mocks.accountFindMany.mockResolvedValue([{ id: "a5", email: "NEW@example.test" }]);
    mocks.userFindMany.mockResolvedValue([{ id: "u7", email: "staff@example.test", displayName: "Stan Staff" }]);
    const full = await listPendingPeople("full");
    expect(full.map((row) => [row.name, row.what, row.href])).toEqual([
      ["Nia New", "Director of Synthetic Club", "/admin/people/account/a5"],
      ["Stan Staff", "Staff login, not activated yet", "/admin/people/staff/u7"],
    ]);
    expect(mocks.inviteFindMany.mock.calls[0][0].where).toMatchObject({ status: { in: ["PENDING", "SENT"] }, cancelledAt: null, acceptedAt: null, organization: { type: "CLUB" } });
    expect(mocks.userFindMany.mock.calls[0][0].where).toMatchObject({ accountStatus: "PENDING_ACTIVATION" });

    mocks.userFindMany.mockClear();
    const clubs = await listPendingPeople("clubs");
    expect(clubs.map((row) => row.what)).toEqual(["Director of Synthetic Club"]);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });
});

describe("the People list with filters", () => {
  const render = (props: Partial<Parameters<typeof PeopleDirectory>[0]>) => renderToStaticMarkup(createElement(PeopleDirectory, {
    query: "", rows: [], page: 1, pageCount: 1, total: 0, eventOptions: [{ id: "evt_1", name: "Synthetic Event" }], clubOptions: [{ id: "org_1", name: "Synthetic Club" }], ...props,
  }));

  it("asks for an event instead of listing an event role across events", () => {
    expect(render({ filters: filtersFor("event-event-admin") })).toContain("Pick an event to see who has this role");
  });

  it("gives a Clubs Administrator no system or event options and no event picker", () => {
    const html = render({ scope: "clubs" });
    expect(html).not.toContain("System administrator");
    expect(html).not.toContain("Event Administrator");
    expect(html).not.toContain('name="event"');
    expect(html).toContain('value="club-director"');
  });

  it("keeps the filter in Previous and Next, and shows Clear", () => {
    const html = render({ filters: filtersFor("club-director", { club: "org_1" }), page: 2, pageCount: 3, total: 60 });
    expect(html).toContain("/admin/people?role=club-director&amp;club=org_1");
    expect(html).toContain("page=3");
    expect(html).toContain('href="/admin/people"');
  });

  it("renders pending invites read only, linking only when the person exists", () => {
    const html = render({ filters: filtersFor("pending"), pending: [
      { key: "k1", name: "Nia New", email: "new@example.test", what: "Director of Synthetic Club", href: null },
      { key: "k2", name: "Stan Staff", email: "staff@example.test", what: "Staff login, not activated yet", href: "/admin/people/staff/u7" },
    ], total: 2 });
    expect(html).toContain("Director of Synthetic Club");
    expect(html).toContain('href="/admin/people/staff/u7"');
    expect(html).not.toContain("Resend");
  });
});

describe("Club leaders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads only current roles in CLUB organizations, narrowed by club and role", () => {
    expect(parseLeaderFilters({ club: "org_1", role: "Deputy" })).toEqual({ clubId: "org_1", role: "DEPUTY" });
    expect(parseLeaderFilters({ role: "owner" })).toEqual({ clubId: null, role: null });
    expect(buildLeadersWhere({ clubId: null, role: null }, now)).toEqual({
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      role: { in: ["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] },
      organization: { type: "CLUB" },
    });
    expect(buildLeadersWhere({ clubId: "org_1", role: "REPORTER" }, now)).toMatchObject({ role: "REPORTER", organization: { type: "CLUB", id: "org_1" } });
  });

  it("sorts by club name, then Director, Deputy, Registrar, Reporter, then name", async () => {
    const grant = (id: string, club: string, role: string, name: string) => ({
      id, role, attendeeAccount: { id: `a-${id}`, displayName: name, email: `${id}@example.test` }, organization: { id: `o-${club}`, name: club },
    });
    mocks.grantFindMany.mockResolvedValue([
      grant("1", "Beta Club", "DIRECTOR", "Zed"), grant("2", "Alpha Club", "REPORTER", "Amy"), grant("3", "Alpha Club", "DIRECTOR", "Bob"), grant("4", "Alpha Club", "DEPUTY", "Cy"), grant("5", "Alpha Club", "DEPUTY", "Abe"),
    ]);
    const leaders = await listClubLeaders({ clubId: null, role: null }, now);
    expect(leaders.map((leader) => leader.key)).toEqual(["3", "5", "4", "2", "1"]);
    expect(mocks.grantFindMany.mock.calls[0][0].where.organization).toEqual({ type: "CLUB" });
    expect(sortClubLeaders([])).toEqual([]);
  });

  it("links people only for a viewer who can open People & access", () => {
    const leaders = [{ key: "k", accountId: "a1", name: "Dee Director", email: "dee@example.test", clubId: "o1", clubName: "Synthetic Club", role: "DIRECTOR" as const, roleLabel: "Director" }];
    const props = { leaders, clubs: [{ id: "o1", name: "Synthetic Club" }], filters: { clubId: null, role: null } };
    expect(renderToStaticMarkup(createElement(ClubLeadersList, { ...props, canOpenPeople: true }))).toContain('href="/admin/people/account/a1"');
    const plain = renderToStaticMarkup(createElement(ClubLeadersList, { ...props, canOpenPeople: false }));
    expect(plain).not.toContain("/admin/people");
    expect(plain).toContain("Dee Director");
  });

  it("is a Clubs tab", () => {
    expect(clubsAdminTabs("2026-27").map((tab) => tab.href)).toContain("/admin/clubs/leaders");
  });
});

describe("link gates", () => {
  it("shows the club Team link only to staff acting who may open People & access", () => {
    const acting = { kind: "STAFF_ACTING" as const, userId: "u1" };
    expect(clubTeamPeopleLinkAllowed(acting, { user: { id: "u1" }, scope: "full" })).toBe(true);
    expect(clubTeamPeopleLinkAllowed(acting, { user: { id: "u1" }, scope: "clubs" })).toBe(true);
    expect(clubTeamPeopleLinkAllowed(acting, { user: { id: "u1" }, scope: null })).toBe(false);
    expect(clubTeamPeopleLinkAllowed(acting, { user: { id: "someone-else" }, scope: "full" })).toBe(false);
    expect(clubTeamPeopleLinkAllowed({ kind: "ATTENDEE" }, { user: { id: "u1" }, scope: "full" })).toBe(false);
  });

  it("renders the directors and team links only when allowed", async () => {
    const { ClubDirectorsWorkspace } = await import("@/components/club-directors-workspace");
    const grants = [{
      id: "g1", organizationId: "o1", role: "DIRECTOR", status: "ACTIVE", effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: null, reason: "Sample", revokedAt: null, revokeReason: null,
      createdAt: "2026-01-01T00:00:00.000Z", account: { id: "a1", displayName: "Dee Director", email: "dee@example.test" }, grantedBy: null, revokedBy: null,
    }];
    const show = (canOpenPeople: boolean) => renderToStaticMarkup(createElement(ClubDirectorsWorkspace, { club: { id: "o1", name: "Synthetic Club", isActive: true }, initialGrants: grants as never, canOpenPeople }));
    expect(show(true)).toContain("See all of this person&#x27;s access");
    expect(show(true)).toContain('href="/admin/people/account/a1"');
    expect(show(false)).not.toContain("See all of this person");

    const { ClubTeamWorkspace } = await import("@/components/club-team-workspace");
    const team = [{ id: "t1", accountId: "a1", displayName: "Dee Director", email: "dee@example.test", role: "DIRECTOR", removableByClub: false }];
    const showTeam = (canOpenPeople: boolean) => renderToStaticMarkup(createElement(ClubTeamWorkspace, { initialTeam: team as never, initialInvites: [], organizationId: "o1", viewerAccountId: null, canOpenPeople }));
    expect(showTeam(true)).toContain('href="/admin/people/account/a1"');
    expect(showTeam(false)).not.toContain("/admin/people");
  });

  it("drops the system and Clubs Administrator toggles from the Event Staff dialog and links to the person page", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/staff-workspace.tsx", "utf8");
    for (const gone of ["changeGlobalRole", "changeClubsAdministrator", "confirmingClubsAdmin", "Make system administrator", "Make Clubs Administrator"]) expect(source, gone).not.toContain(gone);
    expect(source).toContain("canOpenPeople &&");
    expect(source).toContain("/admin/people/staff/${selected.user.id}");
    const page = readFileSync("app/(workspace)/staff/page.tsx", "utf8");
    expect(page).toContain("(await resolvePeopleViewer()).scope !== null");
  });
});
