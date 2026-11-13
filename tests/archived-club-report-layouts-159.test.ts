import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  saveClubReportLayout: vi.fn(),
  deleteClubReportLayout: vi.fn(),
  listClubReportLayouts: vi.fn(),
  runClubReport: vi.fn(),
  resolveClubReportFilters: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.unmock("@/modules/events/archived-read-only");
vi.unmock("@/modules/events/archived-read-only-guard");
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: vi.fn() }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: vi.fn() }));
vi.mock("@/modules/reporting/export-scope", () => ({ eventFileScope: vi.fn() }));
vi.mock("@/modules/reporting/club-report-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/reporting/club-report-export")>()),
  saveClubReportLayout: mocks.saveClubReportLayout,
  deleteClubReportLayout: mocks.deleteClubReportLayout,
  listClubReportLayouts: mocks.listClubReportLayouts,
  runClubReport: mocks.runClubReport,
  resolveClubReportFilters: mocks.resolveClubReportFilters,
}));

import { handleClubReportRequest } from "@/modules/reporting/club-report-api";
import { EVENT_ARCHIVED_READ_ONLY_MESSAGE } from "@/modules/events/archived-read-only";

const base = {
  eventId: "e1",
  viewer: { kind: "staff", canViewDietaryDetails: false } as never,
  actor: { kind: "staff", userId: "u1" } as never,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue({ event: { findUnique: vi.fn(async () => ({ archivedAt: new Date("2026-10-01T00:00:00Z"), isBillingContainer: false })) } });
  mocks.listClubReportLayouts.mockResolvedValue([]);
  mocks.resolveClubReportFilters.mockResolvedValue({});
  mocks.runClubReport.mockResolvedValue({ rows: [] });
});

describe("club report layouts on an archived event (#159)", () => {
  it.each([
    [{ action: "save-layout", name: "Mine", columns: ["name"] }],
    [{ action: "delete-layout", layoutId: "l1" }],
  ])("refuses %j with 409 EVENT_ARCHIVED", async (body) => {
    const response = await handleClubReportRequest({ ...base, body });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "EVENT_ARCHIVED", message: EVENT_ARCHIVED_READ_ONLY_MESSAGE });
    expect(mocks.saveClubReportLayout).not.toHaveBeenCalled();
    expect(mocks.deleteClubReportLayout).not.toHaveBeenCalled();
  });

  it("still builds a report", async () => {
    const response = await handleClubReportRequest({ ...base, body: { action: "preview", columns: ["name"] } });
    expect(response.status).toBe(200);
    expect(mocks.runClubReport).toHaveBeenCalled();
  });

  it("saves a layout when the event is not archived", async () => {
    mocks.getPrisma.mockReturnValue({ event: { findUnique: vi.fn(async () => ({ archivedAt: null, isBillingContainer: false })) } });
    mocks.saveClubReportLayout.mockResolvedValue({ id: "l1" });
    const response = await handleClubReportRequest({ ...base, body: { action: "save-layout", name: "Mine", columns: ["name"] } });
    expect(response.status).toBe(201);
  });
});
