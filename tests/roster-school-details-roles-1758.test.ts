import { readFileSync } from "node:fs";
import path from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who the read-only club pages show school type and church membership to (#1758, follows #1668 and #1685).
 * An active Area Coordinator on their club page, and a Clubs Administrator or system administrator on the staff
 * club page, see them (view only). The club's roster is loaded with them only on those pages; an event manager's
 * club page never asks for them. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  currentAreaCoordinatorViewerActive: vi.fn(),
  organizationFindUnique: vi.fn(),
  getCurrentSession: vi.fn(),
  hasClubsAdministration: vi.fn(),
  canAdministerClubOrganization: vi.fn(),
  listClubImports: vi.fn(),
  resolveStaffGuardianViewer: vi.fn(),
  resolveAreaGuardianViewer: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/components/club-overview", () => ({ ClubOverview: function ClubOverview() { return null; } }));
vi.mock("@/components/club-guardians-panel", () => ({ ClubGuardiansPanel: () => null }));
vi.mock("@/components/role-setup-help", () => ({ CoordinatorSetupHelp: () => null }));
vi.mock("@/components/act-as-button", () => ({ ActAsButton: () => null }));
vi.mock("@/components/club-import-year-move", () => ({ ClubImportYearMove: () => null }));
vi.mock("@/components/admin-hub", () => ({ HubCardGroup: () => null }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ organization: { findUnique: mocks.organizationFindUnique } }) }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinatorMaySeeClub: mocks.currentAreaCoordinatorViewerActive }));
vi.mock("@/modules/background-checks/notes-access", () => ({ canSeeIssuesTextForAreaClub: () => true }));
vi.mock("@/modules/club-rosters/guardians-access", () => ({
  resolveAreaGuardianViewer: mocks.resolveAreaGuardianViewer,
  resolveStaffGuardianViewer: mocks.resolveStaffGuardianViewer,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: mocks.hasClubsAdministration }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/organizations/access", () => ({ canAdministerClubOrganization: mocks.canAdministerClubOrganization }));
vi.mock("@/modules/club-imports/move-year", () => ({ listClubImports: mocks.listClubImports }));

import AreaClubPage from "@/app/(public)/account/(portal)/area/[organizationId]/page";
import StaffOpenClubPage from "@/app/(workspace)/admin/organizations/[organizationId]/club/page";

const params = Promise.resolve({ organizationId: "club-1" });

/** The props of the ClubOverview element in a page's returned tree (the page is not rendered). */
function clubOverviewProps(node: ReactNode): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = clubOverviewProps(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const element = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  if (typeof element.type === "function" && element.type.name === "ClubOverview") return element.props;
  return clubOverviewProps(element.props.children);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.organizationFindUnique.mockResolvedValue({ type: "CLUB", name: "Sample Pathfinders", isActive: true, parentOrganization: { name: "Sample Church" } });
  mocks.resolveAreaGuardianViewer.mockResolvedValue(undefined);
  mocks.resolveStaffGuardianViewer.mockResolvedValue(undefined);
  mocks.canAdministerClubOrganization.mockResolvedValue(false);
  mocks.listClubImports.mockResolvedValue([]);
});

describe("an Area Coordinator's club page", () => {
  it("shows school details, view only, to an active Area Coordinator", async () => {
    mocks.currentAreaCoordinatorViewerActive.mockResolvedValue(true);
    const props = clubOverviewProps(await AreaClubPage({ params }));
    expect(props).toMatchObject({ schoolDetails: true, portalView: true, reportsEditable: false });
  });

  it("does not open for anyone who is not an active Area Coordinator", async () => {
    mocks.currentAreaCoordinatorViewerActive.mockResolvedValue(false);
    await expect(AreaClubPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
  });
});

describe("the staff club page", () => {
  it.each([
    ["a system administrator", { id: "usr-1", globalRole: "SYSTEM_ADMIN" }],
    ["a Clubs Administrator who is not a system administrator", { id: "usr-2", globalRole: "STAFF" }],
  ])("shows school details, view only, to %s", async (_label, user) => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    mocks.hasClubsAdministration.mockResolvedValue(true);
    const props = clubOverviewProps(await StaffOpenClubPage({ params, searchParams: Promise.resolve({}) }));
    expect(props).toMatchObject({ schoolDetails: true });
  });

  it("does not open for staff without Clubs Administration (event managers, registrars)", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "usr-3", globalRole: "STAFF" } });
    mocks.hasClubsAdministration.mockResolvedValue(false);
    await expect(StaffOpenClubPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT /no-access");
    expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
  });
});

describe("where the roster is loaded with school details", () => {
  const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  it("loads the club overview's roster with them only when the page asks for them", () => {
    expect(source("components/club-overview.tsx")).toMatch(/listRoster\(organizationId, shownRosterYear, now, \{ includeSchoolDetails: schoolDetails \}\)/);
    expect(source("components/club-overview.tsx")).toMatch(/schoolDetails = false,/);
  });

  it("never asks for them on an event manager's club page", () => {
    expect(source("app/(workspace)/more/clubs/[organizationId]/page.tsx")).not.toMatch(/schoolDetails/);
  });
});
