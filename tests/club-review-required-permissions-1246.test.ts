import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1246: only a system administrator or an active Clubs Administrator can mark a monthly record Reviewed or change a
 * club form's Required setting, through the real gate (`requireClubsAdministration`). Plain staff and a revoked Clubs
 * Administrator get 403. Directors and Area Coordinators have no staff session, so they get 401 here, and they only
 * ever see "Reviewed" read-only. Only the session, the grant lookup and the writes behind each route are faked.
 * Synthetic data only.
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  grantFindFirst: vi.fn(),
  setClubReportReviewed: vi.fn(),
  setClubFormTemplateRequirement: vi.fn(),
}));

vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ clubsAdministratorGrant: { findFirst: mocks.grantFindFirst } }) }));
vi.mock("@/modules/club-reports/review", () => ({ setClubReportReviewed: mocks.setClubReportReviewed }));
vi.mock("@/modules/club-forms/templates", async (importOriginal) => ({ ...(await importOriginal<object>()), setClubFormTemplateRequirement: mocks.setClubFormTemplateRequirement }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { PUT as reviewRoute } from "@/app/api/admin/club-reports/[organizationId]/[month]/review/route";
import { PUT as requirementRoute } from "@/app/api/admin/club-forms/[templateKey]/requirement/route";
import { ClubReportForm } from "@/components/club-report-form";

type Role = "systemAdmin" | "clubsAdmin" | "revokedClubsAdmin" | "plainStaff";
const roles: Record<Role, { id: string; globalRole: "SYSTEM_ADMIN" | null }> = {
  systemAdmin: { id: "u-sys", globalRole: "SYSTEM_ADMIN" },
  clubsAdmin: { id: "u-clubs", globalRole: null },
  revokedClubsAdmin: { id: "u-revoked", globalRole: null },
  plainStaff: { id: "u-plain", globalRole: null },
};

function signInAs(role: Role) {
  const user = { ...roles[role], email: `${role}@imsda-events.test`, displayName: role };
  mocks.getCurrentSession.mockResolvedValue({ user });
  mocks.grantFindFirst.mockImplementation(async ({ where }: { where: { userId: string; revokedAt: null } }) => (
    role === "clubsAdmin" && where.userId === user.id && where.revokedAt === null ? { id: "grant-1" } : null
  ));
}

const json = (body: unknown) => new Request("https://events.imsda.test/api", {
  method: "PUT",
  headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
  body: JSON.stringify(body),
});
const reviewCall = (reviewed = true) => reviewRoute(json({ reviewed }), { params: Promise.resolve({ organizationId: "club-1", month: "2026-10" }) });
const requirementCall = (body: unknown = { requirement: "ONCE_PER_CLUB_YEAR" }) => requirementRoute(json(body), { params: Promise.resolve({ templateKey: "can_collecting_report" }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setClubReportReviewed.mockResolvedValue({ reviewedAt: "2026-10-26T18:00:00.000Z", changed: true });
  mocks.setClubFormTemplateRequirement.mockResolvedValue({ key: "can_collecting_report", requirement: "ONCE_PER_CLUB_YEAR", requiredRoles: [] });
});

describe.each([
  ["marking a monthly record Reviewed", reviewCall, () => mocks.setClubReportReviewed],
  ["changing a form's Required setting", () => requirementCall(), () => mocks.setClubFormTemplateRequirement],
] as const)("%s", (_name, call, effect) => {
  for (const role of ["systemAdmin", "clubsAdmin"] as const) {
    it(`lets ${role} do it`, async () => {
      signInAs(role);
      expect((await call()).status).toBe(200);
      expect(effect()).toHaveBeenCalledTimes(1);
    });
  }
  for (const role of ["revokedClubsAdmin", "plainStaff"] as const) {
    it(`refuses ${role} with a 403 and changes nothing`, async () => {
      signInAs(role);
      expect((await call()).status).toBe(403);
      expect(effect()).not.toHaveBeenCalled();
    });
  }
  it("refuses a director or Area Coordinator (no staff session) with a 401 and changes nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call()).status).toBe(401);
    expect(effect()).not.toHaveBeenCalled();
  });
});

describe("what is passed through", () => {
  it("records the signed-in user as the actor, for a Clubs Administrator and a system administrator alike", async () => {
    signInAs("clubsAdmin");
    await reviewCall(false);
    expect(mocks.setClubReportReviewed).toHaveBeenLastCalledWith("club-1", "2026-10", false, "u-clubs");
    signInAs("systemAdmin");
    await requirementCall({ requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["YOUTH", "STAFF"] });
    expect(mocks.setClubFormTemplateRequirement).toHaveBeenLastCalledWith("can_collecting_report", { requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["YOUTH", "STAFF"] }, "u-sys");
  });

  it("rejects a per-member requirement with no role, and a body with extra fields", async () => {
    signInAs("clubsAdmin");
    expect((await requirementCall({ requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: [] })).status).toBe(400);
    expect((await requirementCall({ requirement: "ONCE_PER_CLUB_YEAR", enabled: true })).status).toBe(400);
    expect((await reviewRoute(json({ reviewed: true, reviewedByUserId: "someone" }), { params: Promise.resolve({ organizationId: "club-1", month: "2026-10" }) })).status).toBe(400);
    expect(mocks.setClubFormTemplateRequirement).not.toHaveBeenCalled();
    expect(mocks.setClubReportReviewed).not.toHaveBeenCalled();
  });

  it("answers malformed JSON with a 400, not a 500", async () => {
    signInAs("clubsAdmin");
    const bad = new Request("https://events.imsda.test/api", { method: "PUT", headers: { "content-type": "application/json", origin: "https://events.imsda.test" }, body: "{not json" });
    expect((await reviewRoute(bad, { params: Promise.resolve({ organizationId: "club-1", month: "2026-10" }) })).status).toBe(400);
    expect(mocks.setClubReportReviewed).not.toHaveBeenCalled();
  });

  it("rejects a month that is not a report month", async () => {
    signInAs("clubsAdmin");
    const response = await reviewRoute(json({ reviewed: true }), { params: Promise.resolve({ organizationId: "club-1", month: "nope" }) });
    expect(response.status).toBe(400);
  });
});

describe("directors and Area Coordinators read Reviewed but cannot change it", () => {
  const record = {
    id: "r1", organizationId: "club-1", clubYear: "2026-27", reportMonth: "2026-10", meetingPlace: "", meetingSchedule: "",
    averageAttendance: null, pathfinderCount: 1, tltCount: 0, staffCount: 1, investitureDate: null, classLevels: [], points: {}, honors: [],
    onTimePoints: 50, totalPoints: 50, signatureName: "A. Director", signedOn: "2026-10-05", status: "SUBMITTED" as const,
    submittedAt: "2026-10-05T12:00:00.000Z", firstSubmittedAt: "2026-10-05T12:00:00.000Z", reviewedAt: "2026-10-20T12:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z",
  };
  const render = (reviewedAt: string | null) => renderToStaticMarkup(createElement(ClubReportForm, {
    dueLabel: "November 10", endpoint: "/api/attendee/area-report-read-only", expectedOnTime: 0, initial: { ...record, reviewedAt },
    monthLabel: "October 2026", prefill: { meetingPlace: "", meetingSchedule: "", pathfinderCount: 1, tltCount: 0, staffCount: 1, averageAttendance: null, honors: [] },
    readOnly: true,
  }));

  it("shows the Reviewed chip and no Mark reviewed control", () => {
    const html = render(record.reviewedAt);
    expect(html).toContain("Reviewed");
    expect(html).not.toMatch(/Mark reviewed|Undo reviewed/);
  });

  it("shows no Reviewed chip before the mark", () => {
    expect(render(null)).not.toContain("data-report-reviewed");
  });
});
