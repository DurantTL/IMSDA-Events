import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), allowed: vi.fn(), detail: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  notFound: () => { throw new Error("notFound"); },
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.session }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: mocks.allowed }));
vi.mock("@/modules/club-reports/year-end-repository", () => ({ getYearEndClubDetail: mocks.detail }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
vi.mock("@/components/club-year-end-report-form", () => ({ ClubYearEndReportForm: () => null }));
import Page from "@/app/(workspace)/admin/clubs/reports/year-end/[organizationId]/[year]/page";

const render = (year = "2026-27", organizationId = "club-1") =>
  Page({ params: Promise.resolve({ organizationId, year }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T18:00:00Z"));
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "synthetic-admin" } });
  mocks.allowed.mockResolvedValue(true);
  mocks.detail.mockResolvedValue({ name: "Alpha", church: "", directors: [], status: "NONE", late: false, submittedAt: null, report: null });
});
afterEach(() => vi.useRealTimers());

describe("staff year-end detail page guard (#1843)", () => {
  it("sends a signed-out visitor to sign in and a user without clubs administration to /no-access, reading nothing", async () => {
    mocks.session.mockResolvedValue({ user: null });
    await expect(render()).rejects.toThrow("redirect:/login");
    mocks.session.mockResolvedValue({ user: { id: "ordinary-user" } });
    mocks.allowed.mockResolvedValue(false);
    await expect(render()).rejects.toThrow("redirect:/no-access");
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("is not found for an invalid year, a year that has not started, or a non-club", async () => {
    await expect(render("nonsense")).rejects.toThrow("notFound");
    await expect(render("2027-28")).rejects.toThrow("notFound");
    mocks.detail.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("notFound");
  });

  it("renders for the current year", async () => {
    await expect(render()).resolves.toBeTruthy();
  });
});
