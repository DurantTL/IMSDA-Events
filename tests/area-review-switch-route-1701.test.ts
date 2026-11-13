import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1701: only a system administrator or an active Clubs Administrator can turn Area Coordinator review of Monthly Records
 * on or off, through the real gate (`requireClubsAdministration`). Plain staff and a revoked Clubs Administrator get 403;
 * a club director or an Area Coordinator has no staff session and gets 401. Synthetic data only.
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getCurrentSession: vi.fn(), grantFindFirst: vi.fn(), setEnabled: vi.fn() }));

vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ clubsAdministratorGrant: { findFirst: mocks.grantFindFirst } }) }));
vi.mock("@/modules/club-reports/area-review", () => ({ setMonthlyRecordAreaReviewEnabled: mocks.setEnabled }));

import { PUT } from "@/app/api/admin/club-reports/monthly-area-review/route";

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

const call = (body: unknown = { enabled: true }) => PUT(new Request("https://events.imsda.test/api/admin/club-reports/monthly-area-review", {
  method: "PUT",
  headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
  body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setEnabled.mockResolvedValue({ clubYear: "2026-27", enabled: true, changed: true });
});

describe("turning Area Coordinator review on or off (#1701)", () => {
  for (const role of ["systemAdmin", "clubsAdmin"] as const) {
    it(`lets ${role} do it, as that user`, async () => {
      signInAs(role);
      expect((await call()).status).toBe(200);
      expect(mocks.setEnabled).toHaveBeenCalledWith(true, roles[role].id);
    });
  }
  for (const role of ["revokedClubsAdmin", "plainStaff"] as const) {
    it(`refuses ${role} with a 403 and changes nothing`, async () => {
      signInAs(role);
      expect((await call()).status).toBe(403);
      expect(mocks.setEnabled).not.toHaveBeenCalled();
    });
  }
  it("refuses a club director or Area Coordinator (no staff session) with a 401", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call()).status).toBe(401);
    expect(mocks.setEnabled).not.toHaveBeenCalled();
  });
  it("refuses a body that is not exactly { enabled: boolean }", async () => {
    signInAs("clubsAdmin");
    expect((await call({ enabled: "yes" })).status).toBe(400);
    expect((await call({ enabled: true, clubYear: "2020-21" })).status).toBe(400);
    expect(mocks.setEnabled).not.toHaveBeenCalled();
  });
});
