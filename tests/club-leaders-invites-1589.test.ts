import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1589 (decision on #1660): Club leaders has a status filter, and Club invites is its Invited view. Synthetic data only. */

vi.mock("server-only", () => ({}));
vi.mock("@/modules/attendee-accounts/two-step-status", () => ({ accountHasTwoStepOn: async () => false, accountIdsWithTwoStepOn: async () => new Set<string>() }));
const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  permanentRedirect: vi.fn((to: string) => { throw new Error(`PERMANENT ${to}`); }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: nav.redirect,
  permanentRedirect: nav.permanentRedirect,
}));
const access = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, allowed: true }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => ({ user: access.user }) }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: async () => access.allowed }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/staff/sign-in" }));
const db = vi.hoisted(() => ({ inviteFindMany: vi.fn(), inviteCount: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ clubInvite: { findMany: db.inviteFindMany, count: db.inviteCount } }) }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://example.test" }) }));

import ClubInvitesPage from "@/app/(workspace)/admin/clubs/invites/page";
import { ClubLeadersList } from "@/components/club-leaders-list";
import { clubsAdminActiveHref, clubsAdminGroups } from "@/components/staff-navigation";
import { staffPlaceFor } from "@/components/staff-areas";
import { systemNavActiveItem } from "@/components/system-navigation";
import { countDraftClubInvites, countWaitingClubInvites, listClubLeaderInvites } from "@/modules/system-admin/club-leaders";
import {
  buildInvitesWhere,
  CLUB_INVITES_ORDER_BY,
  clubLeadersHref,
  parseLeaderFilters,
  parseLeaderStatus,
} from "@/modules/system-admin/club-leaders-model";
import { buildHubView, neededMetrics, type HubViewer } from "@/modules/system-admin/admin-hubs-model";

const invite = (id: string, status: "PENDING" | "SENT" = "SENT") => ({
  id, email: `${id}@example.test`, name: `Person ${id}`, role: "DIRECTOR" as const, status, sentAt: new Date("2026-11-01T12:00:00Z"), sentCount: 1, acceptedAt: null,
  organization: { id: "org_1", name: "Synthetic Club", isActive: true },
});

describe("status parsing", () => {
  it("reads current, invited and draft, and anything else is current", () => {
    expect(parseLeaderStatus("invited")).toBe("invited");
    expect(parseLeaderStatus(" Draft ")).toBe("draft");
    expect(parseLeaderStatus(["invited", "draft"])).toBe("invited");
    for (const value of [undefined, "", "accepted", "cancelled", "sent", 3]) expect(parseLeaderStatus(value)).toBe("current");
    expect(parseLeaderFilters({ club: "org_1", role: "deputy", status: "draft" })).toEqual({ clubId: "org_1", role: "DEPUTY", status: "draft" });
  });

  it("keeps the status in the address, leaving it out for Current", () => {
    expect(clubLeadersHref({ clubId: null, role: null, status: "current" })).toBe("/admin/clubs/leaders");
    expect(clubLeadersHref({ clubId: "org_1", role: "REGISTRAR", status: "invited" }, 2)).toBe("/admin/clubs/leaders?club=org_1&role=registrar&status=invited&page=2");
  });
});

describe("the invite query", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks only for SENT (Invited) or PENDING (Draft), never accepted or cancelled", () => {
    expect(buildInvitesWhere({ clubId: null, role: null, status: "invited" })).toEqual({ status: "SENT" });
    expect(buildInvitesWhere({ clubId: null, role: null, status: "draft" })).toEqual({ status: "PENDING" });
    expect(buildInvitesWhere({ clubId: "org_1", role: "REPORTER", status: "invited" })).toEqual({ status: "SENT", role: "REPORTER", organizationId: "org_1" });
  });

  it("filters and pages in the database, in order, and clamps a page past the end", async () => {
    db.inviteCount.mockResolvedValue(120);
    db.inviteFindMany.mockResolvedValue([invite("a")]);
    const result = await listClubLeaderInvites({ clubId: "org_1", role: "DEPUTY", status: "draft" }, 3);
    expect(result).toMatchObject({ total: 120, page: 3, pageSize: 50 });
    const query = db.inviteFindMany.mock.calls[0][0];
    expect(query.where).toEqual({ status: "PENDING", role: "DEPUTY", organizationId: "org_1" });
    expect(query).toMatchObject({ skip: 100, take: 50 });
    expect(query.orderBy).toEqual(CLUB_INVITES_ORDER_BY.map((order) => ({ ...order })));
    expect(db.inviteCount).toHaveBeenCalledWith({ where: query.where });
    expect((await listClubLeaderInvites({ clubId: null, role: null, status: "invited" }, 99)).page).toBe(3);
  });

  it("counts waiting invites as SENT only, and drafts for everyone and for the picked club", async () => {
    db.inviteCount.mockResolvedValue(4);
    expect(await countWaitingClubInvites()).toBe(4);
    expect(db.inviteCount).toHaveBeenLastCalledWith({ where: { status: "SENT" } });
    db.inviteCount.mockClear();
    expect(await countDraftClubInvites("org_1")).toEqual({ all: 4, club: 4 });
    expect(db.inviteCount.mock.calls.map((call) => call[0].where)).toEqual([{ status: "PENDING" }, { status: "PENDING", organizationId: "org_1" }]);
    expect(await countDraftClubInvites(null)).toEqual({ all: 4, club: null });
  });
});

describe("the list on each status", () => {
  const base = { leaders: [], clubs: [{ id: "org_1", name: "Synthetic Club" }], canOpenPeople: false };
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ClubLeadersList, { ...base, ...props } as never));

  it("has a Status select with the three views", () => {
    const html = render({ filters: { clubId: null, role: null, status: "invited" } });
    expect(html).toContain('name="status"');
    for (const label of ["Current", "Invited", "Draft"]) expect(html).toContain(`>${label}</option>`);
    expect(html).toMatch(/<option value="invited" selected/);
  });

  it("shows invite rows with the actions the Club invites page had", () => {
    const html = render({ filters: { clubId: null, role: null, status: "invited" }, invites: [{ id: "a", email: "a@example.test", name: "Person a", role: "DIRECTOR", status: "SENT", sentAt: "2026-11-01T12:00:00.000Z", sentCount: 1, acceptedAt: null, club: { id: "org_1", name: "Synthetic Club", isActive: true } }] });
    expect(html).toContain("Person a");
    expect(html).toContain("Resend");
    expect(html).toContain('aria-label="Change email for Person a"');
    expect(html).toContain('aria-label="Cancel invite for Person a"');
    expect(html).not.toContain("Send all unsent");
  });

  it("offers Send all unsent, and the picked club's own, on Draft only", () => {
    const row = { id: "a", email: "a@example.test", name: "Person a", role: "DIRECTOR", status: "PENDING", sentAt: null, sentCount: 0, acceptedAt: null, club: { id: "org_1", name: "Synthetic Club", isActive: true } };
    const html = render({ filters: { clubId: "org_1", role: null, status: "draft" }, invites: [row], drafts: { all: 7, club: 2 } });
    expect(html).toContain("Send all unsent (7)");
    expect(html).toContain("Send unsent for Synthetic Club");
    expect(html).not.toContain("Resend");
    expect(html).toContain("Draft");
  });

  it("says which status is empty, and whether a club or role narrowed it", () => {
    expect(render({ filters: { clubId: null, role: null, status: "invited" } })).toContain("No invited club invites found.");
    expect(render({ filters: { clubId: null, role: null, status: "invited" } })).toContain("No invites are waiting.");
    expect(render({ filters: { clubId: "org_1", role: null, status: "draft" } })).toContain("No draft invites match that club and role.");
    expect(render({ filters: { clubId: null, role: null } })).toContain("No current club leaders found.");
  });

  it("keeps the status when filters are cleared", () => {
    expect(render({ filters: { clubId: "org_1", role: null, status: "draft" } })).toContain('href="/admin/clubs/leaders?status=draft"');
  });
});

describe("the old Club invites address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.user = { id: "u1" };
    access.allowed = true;
  });

  it("moves permanently to the Invited view, keeping a club filter", async () => {
    await expect(ClubInvitesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("PERMANENT /admin/clubs/leaders?status=invited");
    await expect(ClubInvitesPage({ searchParams: Promise.resolve({ club: "org_1" }) })).rejects.toThrow("PERMANENT /admin/clubs/leaders?club=org_1&status=invited");
    await expect(ClubInvitesPage({ searchParams: Promise.resolve({ club: "a b;c" }) })).rejects.toThrow("PERMANENT /admin/clubs/leaders?status=invited");
  });

  it("answers a signed-out or unauthorized visitor as before, without redirecting them to the list", async () => {
    access.user = null;
    await expect(ClubInvitesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /staff/sign-in");
    access.user = { id: "u1" };
    access.allowed = false;
    await expect(ClubInvitesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /no-access");
    expect(nav.permanentRedirect).not.toHaveBeenCalled();
  });
});

describe("the Clubs dashboard count and the hub", () => {
  const viewer: HubViewer = { isSystemAdmin: false, clubsAdmin: true, siteContentEditor: false, healthImport: false };

  it("draws a Waiting invites card that links to the Invited view and shows 0 plainly", () => {
    const source = readFileSync("app/(workspace)/admin/clubs/page.tsx", "utf8");
    expect(source).toContain('data-card="waiting-invites"');
    expect(source).toContain("Waiting invites");
    expect(source).toContain('status: "invited"');
    expect(source).toContain("countWaitingClubInvites()");
    expect(source).not.toMatch(/waitingInvites \|\| /);
  });

  it("puts the live waiting-invites number on the Club leaders card and drops the separate Club invites card", () => {
    expect(neededMetrics("club-administration", viewer)).toContain("clubInvitesWaiting");
    const cards = buildHubView("club-administration", viewer, { clubLeaders: 168, clubInvitesWaiting: 0, applicationsWaiting: 0, lateRecords: 0, openTransfers: 0, clubFormsOn: 0, honors: 0 }).groups.flatMap((group) => group.cards);
    expect(cards.map((card) => card.title)).not.toContain("Club invites");
    const leaders = cards.find((card) => card.href === "/admin/clubs/leaders")!;
    expect(leaders.status?.text).toBe("168 current leaders · 0 invites waiting");
    expect(leaders.description).toContain("registrars and reporters invited by directors");
    const waiting = buildHubView("club-administration", viewer, { clubLeaders: 1, clubInvitesWaiting: 1 }).groups.flatMap((group) => group.cards).find((card) => card.href === "/admin/clubs/leaders")!;
    expect(waiting.status).toEqual({ tone: "review", text: "1 current leader · 1 invite waiting" });
    expect(buildHubView("club-administration", viewer, { clubLeaders: 1, clubInvitesWaiting: null }).groups.flatMap((group) => group.cards).find((card) => card.href === "/admin/clubs/leaders")!.status?.text).toBe("Unavailable");
  });
});

describe("navigation", () => {
  it("has no separate Club invites sidebar entry, and lights Club leaders for the old address", () => {
    expect(clubsAdminGroups.flatMap((group) => group.items).map((item) => item.href)).not.toContain("/admin/clubs/invites");
    expect(clubsAdminActiveHref("/admin/clubs/invites")).toBe("/admin/clubs/leaders");
    expect(clubsAdminActiveHref("/admin/clubs/leaders")).toBe("/admin/clubs/leaders");
    expect(systemNavActiveItem("/admin/clubs/invites")?.label).toBe("Club leaders");
    expect(systemNavActiveItem("/admin/clubs/applications")?.label).toBe("New club applications");
    expect(staffPlaceFor("/admin/clubs/invites")).toMatchObject({ area: "clubs", tab: "leaders" });
    expect(staffPlaceFor("/admin/clubs/leaders", new URLSearchParams("status=draft"))).toMatchObject({ area: "clubs", tab: "leaders" });
  });
});
