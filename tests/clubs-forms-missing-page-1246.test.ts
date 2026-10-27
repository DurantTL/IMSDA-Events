import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1246: the list page behind "Clubs with forms missing": its gate, and that it shows exactly the clubs the card counts. Synthetic data only. */
const mocks = vi.hoisted(() => ({ getCurrentSession: vi.fn(), hasClubsAdministration: vi.fn(), getRequiredFormsStatus: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: mocks.hasClubsAdministration }));
vi.mock("@/modules/club-forms/required", () => ({ getRequiredFormsStatus: mocks.getRequiredFormsStatus }));

import ClubsFormsMissingPage from "@/app/(workspace)/admin/clubs/forms-missing/page";
import { clubsWithFormsMissing } from "@/modules/club-forms/required-domain";
import { buildClubsAdminHome } from "@/modules/club-reports/clubs-admin-home-model";

const item = (overrides: Record<string, unknown>) => ({ templateKey: "can", name: "Can Collecting Report", requirement: "ONCE_PER_CLUB_YEAR", roles: [], status: "MISSING", missingMembers: [], memberCount: 0, ...overrides });
const status = [
  { id: "c1", name: "Alpha Pathfinders", church: "Alpha Church", items: [item({}), item({ templateKey: "app", name: "Membership Application", requirement: "PER_ROLE_MEMBER_YEAR", roles: ["YOUTH"], missingMembers: [{ id: "m1", name: "Amy Youth" }], memberCount: 4 })] },
  { id: "c2", name: "Beta Pathfinders", church: "", items: [item({ status: "DONE" })] },
  { id: "c3", name: "Gamma Pathfinders", church: "", items: [item({})] },
];
const render = async (year?: string) => renderToStaticMarkup(await ClubsFormsMissingPage({ searchParams: Promise.resolve({ year }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: null } });
  mocks.hasClubsAdministration.mockResolvedValue(true);
  mocks.getRequiredFormsStatus.mockResolvedValue(status);
});

describe("the forms-missing list page", () => {
  it("sends a signed-out visitor to login and anyone without clubs administration away, reading nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(render()).rejects.toThrow("redirect:/login");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: null } });
    mocks.hasClubsAdministration.mockResolvedValue(false);
    await expect(render()).rejects.toThrow("redirect:/no-access");
    expect(mocks.getRequiredFormsStatus).not.toHaveBeenCalled();
  });

  it("lists the clubs missing a form and what each is missing, with counts only for members", async () => {
    const html = await render("2026-27");
    expect(mocks.getRequiredFormsStatus).toHaveBeenCalledWith("2026-27");
    expect(html).toContain("Alpha Pathfinders");
    expect(html).toContain("Gamma Pathfinders");
    expect(html).not.toContain("Beta Pathfinders");
    expect(html).toContain("Membership Application");
    expect(html).toContain("1 of 4 members");
    expect(html).not.toContain("Amy Youth");
    expect(html).toContain("2 clubs are missing a required form");
  });

  it("shows the same number of clubs as the dashboard card", async () => {
    const home = buildClubsAdminHome({ clubYear: "2026-27", now: new Date("2026-10-26T18:00:00Z"), clubs: [], events: [], applications: [], waitingCount: 0, requiredForms: status as never });
    expect(home.counts.clubsWithFormsMissing).toBe(clubsWithFormsMissing(status as never).length);
    expect(await render("2026-27")).toContain(`${home.counts.clubsWithFormsMissing} clubs are missing`);
  });
});
