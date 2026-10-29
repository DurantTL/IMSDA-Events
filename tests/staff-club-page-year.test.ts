import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The staff "Open club" page (#386) with a club-year choice (#541): the
 * import result links here, so staff can see an imported roster in the
 * previous, current, or next year. System administrators only, as before;
 * the "Move import to another year" panel shows only for a club with an import.
 */

const mocks = vi.hoisted(() => ({
  isClubsAdmin: vi.fn(),
  getCurrentSession: vi.fn(),
  orgFindUnique: vi.fn(),
  listClubImports: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/access/admin-roles", () => ({
  isActiveClubsAdministrator: mocks.isClubsAdmin,
  hasClubsAdministration: async (user: { id: string; globalRole?: string | null }) => user.globalRole === "SYSTEM_ADMIN" || mocks.isClubsAdmin(user.id),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ organization: { findUnique: mocks.orgFindUnique } }) }));
vi.mock("@/modules/club-imports/move-year", () => ({ listClubImports: mocks.listClubImports }));
vi.mock("@/modules/club-rosters/guardians-access", () => ({ resolveStaffGuardianViewer: async () => ({ kind: "staff" }) }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));

import StaffOpenClubPage from "@/app/(workspace)/admin/organizations/[organizationId]/club/page";
import { ClubImportYearMove } from "@/components/club-import-year-move";
import { ClubOverview } from "@/components/club-overview";
import { ClubGuardiansPanel } from "@/components/club-guardians-panel";
import { AdminPageHeader } from "@/components/admin-page-header";

type AnyProps = Record<string, unknown>;

function elements(node: ReactNode, found: ReactElement<AnyProps>[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
    return found;
  }
  if (!isValidElement<AnyProps>(node)) return found;
  found.push(node);
  elements(node.props.children as ReactNode, found);
  return found;
}

const open = (year?: string) => StaffOpenClubPage({
  params: Promise.resolve({ organizationId: "club-1" }),
  searchParams: Promise.resolve(year === undefined ? {} : { year }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClubsAdmin.mockResolvedValue(false);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
  mocks.orgFindUnique.mockResolvedValue({ type: "CLUB", name: "Fixture Pathfinders", isActive: true, parentOrganization: null });
  mocks.listClubImports.mockResolvedValue([{ identityId: "identity-1", entryId: "90541", clubYear: "2025-26", peopleOnRoster: 48 }]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the staff club page's club year (#541)", () => {
  it("shows the chosen year's roster, read-only, with links to every directory year and next year", async () => {
    const tree = await open("2025-26");
    const all = elements(tree);
    expect(all.find((element) => element.type === ClubOverview)?.props).toMatchObject({ rosterYear: "2025-26" });
    const clubLinks = all.filter((element) => typeof element.props.href === "string" && String(element.props.href).startsWith("/admin/organizations/club-1/club"));
    // The staff Honors screen (#591) is its own link, not one of the year choices.
    expect(clubLinks.some((link) => link.props.href === "/admin/organizations/club-1/club/honors")).toBe(true);
    const links = clubLinks.filter((link) => link.props.href !== "/admin/organizations/club-1/club/honors");
    expect(links.map((link) => [link.props.href, link.props["aria-current"]])).toEqual([
      ["/admin/organizations/club-1/club?year=2023-24", undefined],
      ["/admin/organizations/club-1/club?year=2024-25", undefined],
      ["/admin/organizations/club-1/club?year=2025-26", "page"],
      ["/admin/organizations/club-1/club", undefined],
      ["/admin/organizations/club-1/club?year=2027-28", undefined],
    ]);
    const texts = all.flatMap((element) => [element.props.children].flat().filter((child): child is string => typeof child === "string"));
    expect(texts.some((text) => text.includes("roster, read-only"))).toBe(true);
  });

  it("opens an older directory year read-only, keeps the year in the back link, and renders no write panels (#1304)", async () => {
    const all = elements(await open("2023-24"));
    expect(all.find((element) => element.type === ClubOverview)?.props).toMatchObject({ rosterYear: "2023-24", reportsEditable: true });
    expect(all.find((element) => element.type === AdminPageHeader)?.props).toMatchObject({ year: "2023-24" });
    expect(all.some((element) => element.type === ClubGuardiansPanel)).toBe(false);
    const texts = all.flatMap((element) => [element.props.children].flat().filter((child): child is string => typeof child === "string"));
    expect(texts.join("")).toContain("roster, read-only");
    expect(texts).toContain("2023-24");
    // Current year still shows the guardians panel.
    expect(elements(await open()).some((element) => element.type === ClubGuardiansPanel)).toBe(true);
    // Next year stays read-only with no guardians panel here (the page never had one for it).
    expect(elements(await open("2027-28")).some((element) => element.type === ClubGuardiansPanel)).toBe(false);
  });

  it("still falls back to the current year beyond the directory's range", async () => {
    expect(elements(await open("2022-23")).find((element) => element.type === ClubOverview)?.props).toMatchObject({ rosterYear: "2026-27" });
  });

  it("falls back to the current year for an invalid year", async () => {
    const all = elements(await open("1999-00"));
    expect(all.find((element) => element.type === ClubOverview)?.props).toMatchObject({ rosterYear: "2026-27" });
  });

  it("offers the Move action for a club with an import, with the three year choices", async () => {
    const all = elements(await open());
    expect(all.find((element) => element.type === ClubImportYearMove)?.props).toEqual({
      imports: [{ identityId: "identity-1", entryId: "90541", clubYear: "2025-26", peopleOnRoster: 48 }],
      organizationId: "club-1",
      yearChoices: ["2025-26", "2026-27", "2027-28"],
    });
    mocks.listClubImports.mockResolvedValue([]);
    expect(elements(await open()).some((element) => element.type === ClubImportYearMove)).toBe(false);
  });

  it("keeps the page for system administrators only", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1", globalRole: "EVENT_STAFF" } });
    await expect(open("2025-26")).rejects.toThrow("REDIRECT /no-access");
    expect(mocks.listClubImports).not.toHaveBeenCalled();
  });
});
