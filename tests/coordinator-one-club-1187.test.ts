import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One club, from the coordinator's workspace (#1187): view only, with the
 * coordinator's navigation, and no route or request that reaches the director's
 * tools (roster editing, Orders, Class tracking, Club settings). Synthetic data.
 */
const mocks = vi.hoisted(() => ({
  currentStaffActingContext: vi.fn(),
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  findOrganization: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

const client = {
  organization: { findUnique: mocks.findOrganization },
  attendeeMfaEnrollment: { findUnique: vi.fn() },
  attendeeSession: { findUnique: vi.fn() },
  attendeePasskey: { count: vi.fn() },
  areaCoordinatorGrant: { findUnique: vi.fn() },
};

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: vi.fn(), usePathname: () => "/account/area/club-a" }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: async () => "OK" }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: async () => false }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));

import AreaClubOrdersPage from "@/app/(public)/account/(portal)/area/[organizationId]/orders/page";
import AreaClubSuppliesPage from "@/app/(public)/account/(portal)/area/[organizationId]/supplies/page";
import { AccountSectionNav } from "@/components/account-section-nav";
import { requireClubOrdersAccess } from "@/modules/club-supplies/access";
import { requireRosterAccess } from "@/modules/club-rosters/access";
import { areaClubPortalNavItems } from "@/modules/club-rosters/portal-nav";

const areaRoot = "app/(public)/account/(portal)/area/[organizationId]";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "coordinator-1" }, via: "attendee", sessionId: "s1" });
  // A coordinator who directs no club: the coordinator grant is not a club role.
  mocks.listDirectedClubs.mockResolvedValue([]);
  mocks.findOrganization.mockResolvedValue({ id: "club-a", type: "CLUB", isActive: true, name: "Club A", parentOrganization: null });
});

describe("the coordinator's club navigation (#1187)", () => {
  const items = areaClubPortalNavItems({ organizationId: "club-a" });

  it("lists exactly the view-only destinations: Home, Roster, Honors, Events, Club forms, Monthly Records, Earned awards", () => {
    expect(items.map((item) => item.label)).toEqual(["Home", "Roster", "Honors", "Events", "Club forms", "Monthly Records", "Earned awards"]);
  });

  it("has no Orders, Class tracking, Club settings or roster editing entry, and every link stays inside this club", () => {
    for (const item of items) {
      expect(item.label).not.toMatch(/orders|class tracking|settings|health|edit/i);
      expect(item.href).toMatch(/^\/account\/area\/club-a(#|\/|$)/);
      expect(item.href).not.toMatch(/\/account\/clubs\//);
    }
  });

  it("renders as the club's own menu", () => {
    const html = renderToStaticMarkup(createElement(AccountSectionNav, { items, label: "Club", variant: "secondary" }));
    expect(html).toContain("Earned awards");
    expect(html).not.toMatch(/Orders|Class tracking|Club settings/);
  });
});

describe("a direct URL cannot reach the director's tools (#1187)", () => {
  it("has no coordinator route for the roster editor, Class tracking, Club settings or Health, and Orders and Supplies answer 404", () => {
    const segments = readdirSync(areaRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    expect(segments).toEqual(["awards", "forms", "honors", "orders", "reports", "supplies"]);
    expect(() => AreaClubOrdersPage()).toThrow("NOT_FOUND");
    expect(() => AreaClubSuppliesPage()).toThrow("NOT_FOUND");
  });

  it("serves the page and its sections without any editing control", () => {
    const source = readFileSync(`${areaRoot}/page.tsx`, "utf8");
    expect(source).toMatch(/reportsEditable=\{false\}/);
    expect(source).toMatch(/portalView/);
  });

  it("refuses the roster API to an account that only holds the coordinator grant", async () => {
    await expect(requireRosterAccess("club-a")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(requireRosterAccess("club-a", new Date(), "manageTeam")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses the roster API to a staff act-as of an Area Coordinator, whatever club is named", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.currentStaffActingContext.mockResolvedValue({ userId: "staff-1", staffSessionId: "ss-1", actAsId: "act-1", role: "AREA_COORDINATOR", organizationId: null });
    await expect(requireRosterAccess("club-a")).rejects.toMatchObject({ status: 401 });
  });

  it("keeps the Orders loaders closed to a signed-in coordinator and to a staff act-as", async () => {
    client.areaCoordinatorGrant.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
    await expect(requireClubOrdersAccess("club-a")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.currentStaffActingContext.mockResolvedValue({ userId: "staff-1", staffSessionId: "ss-1", actAsId: "act-1", role: "AREA_COORDINATOR", organizationId: null });
    await expect(requireClubOrdersAccess("club-a")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
