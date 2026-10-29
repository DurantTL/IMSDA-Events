import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1304: the staff Honors page and its reload route share one year range, so the club page links a year only when both accept it. */

const mocks = vi.hoisted(() => ({
  listClubHonorsPage: vi.fn(),
  listClubTeam: vi.fn(),
  listRoster: vi.fn(),
  listClubEvents: vi.fn(),
  getClubReportYear: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => ({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } }) }));
vi.mock("@/modules/organizations/access", () => ({ canAdministerClubOrganization: async () => true }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ organization: { findUnique: async () => ({ type: "CLUB", name: "Fixture Pathfinders", isActive: true }) } }) }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
vi.mock("@/modules/honors/member-honor-repository", () => ({ listClubHonorsPage: mocks.listClubHonorsPage, listActiveHonorOptions: async () => [] }));
vi.mock("@/modules/organizations/director-grants-repository", () => ({ listClubTeam: mocks.listClubTeam }));
vi.mock("@/modules/club-rosters/repository", () => ({ listRoster: mocks.listRoster }));
vi.mock("@/modules/club-registrations/repository", () => ({ listClubEvents: mocks.listClubEvents }));
vi.mock("@/modules/club-reports/repository", () => ({ getClubReportYear: mocks.getClubReportYear }));
vi.mock("@/modules/background-checks/repository", () => ({ clubComplianceReminderCounts: async () => null, clubRosterComplianceStatuses: async () => null }));

import HonorsPage from "@/app/(workspace)/admin/organizations/[organizationId]/club/honors/page";
import { ClubOverview } from "@/components/club-overview";
import { ClubHonorsWorkspace } from "@/components/club-honors-workspace";
import { ClubYearTiles } from "@/components/club-year-tiles";

type AnyProps = Record<string, unknown>;
function elements(node: ReactNode, found: ReactElement<AnyProps>[] = []) {
  if (Array.isArray(node)) { for (const child of node) elements(child, found); return found; }
  if (!isValidElement<AnyProps>(node)) return found;
  found.push(node);
  elements(node.props.children as ReactNode, found);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-26T18:00:00Z"));
  mocks.listClubHonorsPage.mockResolvedValue([]);
  mocks.listClubTeam.mockResolvedValue([]); mocks.listRoster.mockResolvedValue([]); mocks.listClubEvents.mockResolvedValue([]);
  mocks.getClubReportYear.mockResolvedValue({ reports: [], registrationOnTime: false });
});

describe("staff Honors page year", () => {
  it("shows the current year for a directory year its reload route does not accept", async () => {
    const tree = await HonorsPage({ params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({ year: "2023-24" }) });
    expect(elements(tree).find((e) => e.type === ClubHonorsWorkspace)?.props).toMatchObject({ clubYear: "2026-27" });
    expect(mocks.listClubHonorsPage).toHaveBeenCalledWith("club-1", "2026-27");
    const prev = await HonorsPage({ params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({ year: "2025-26" }) });
    expect(elements(prev).find((e) => e.type === ClubHonorsWorkspace)?.props).toMatchObject({ clubYear: "2025-26" });
  });
});

describe("club overview Honors link", () => {
  const honorsHref = async (rosterYear: string) => {
    const tree = await ClubOverview({ organizationId: "club-1", rosterYear, staffHonorsHref: "/admin/organizations/club-1/club/honors", reportHref: () => "/r", reportsEditable: true });
    return elements(tree).find((e) => e.type === ClubYearTiles)?.props.honorsHref;
  };
  it("carries the year only when the Honors page accepts it", async () => {
    expect(await honorsHref("2023-24")).toBe("/admin/organizations/club-1/club/honors");
    expect(await honorsHref("2025-26")).toBe("/admin/organizations/club-1/club/honors?year=2025-26");
    expect(await honorsHref("2027-28")).toBe("/admin/organizations/club-1/club/honors?year=2027-28");
    expect(await honorsHref("2026-27")).toBe("/admin/organizations/club-1/club/honors");
  });
});
