import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1221: the Area Coordinator's send-a-link route, with the exact body the form posts and the real grant rules. */
const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  grantFindUnique: vi.fn(),
  currentStaffActingContext: vi.fn(),
  createClubFormLink: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ areaCoordinatorGrant: { findUnique: mocks.grantFindUnique } }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/modules/club-rosters/access", () => ({ requireRosterAccess: vi.fn(), RosterAccessError: class extends Error {} }));
vi.mock("@/modules/club-rosters/api-errors", () => ({ RosterBodyError: class extends Error {}, readRosterJson: async (request: Request) => request.json() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: vi.fn() }));
vi.mock("@/modules/rate-limit/service", () => ({ checkClubFormLinkCreateRateLimit: mocks.rateLimit }));
vi.mock("@/modules/club-forms/links", () => ({ createClubFormLink: mocks.createClubFormLink }));

import { POST } from "@/app/api/attendee/area-clubs/[organizationId]/forms/links/route";
import { clubFormLinkRequestBody } from "@/components/club-form-link-body";
import { ClubFormError } from "@/modules/club-forms/errors";

const context = { params: Promise.resolve({ organizationId: "club-b" }) };
const post = (body: unknown) => POST(new Request("https://events.example.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), context);
// Exactly what the coordinator's form sends.
const componentBody = clubFormLinkRequestBody({ templateKey: "tlt_program_recommendation", recipientEmail: "casey@example.test", rosterMemberId: "", subjectName: "", days: "14", asAreaCoordinator: true });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-2" }, via: "attendee", sessionId: "s-1" });
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
  mocks.rateLimit.mockResolvedValue({ allowed: true });
  mocks.createClubFormLink.mockResolvedValue({ linkId: "link-1", messageId: "message-1", expiresAt: new Date("2026-11-09T15:00:00Z") });
});

describe("POST /api/attendee/area-clubs/[organizationId]/forms/links (#1221)", () => {
  it("accepts the body the form posts, which has no roster member key", async () => {
    expect(componentBody).not.toHaveProperty("rosterMemberId");
    const response = await post(componentBody);
    expect(response.status).toBe(201);
    expect(mocks.createClubFormLink).toHaveBeenCalledWith(expect.objectContaining({ kind: "AREA_COORDINATOR" }), expect.objectContaining({ organizationId: "club-b", templateKey: "tlt_program_recommendation", rosterMemberId: null }));
  });

  it("accepts a null roster member and refuses a real one", async () => {
    expect((await post({ ...componentBody, rosterMemberId: null })).status).toBe(201);
    const refused = await post({ ...componentBody, rosterMemberId: "member-1" });
    expect(refused.status).toBe(400);
    expect(mocks.createClubFormLink).toHaveBeenCalledTimes(1);
  });

  it("refuses a revoked grant and an expired one, creating nothing", async () => {
    for (const grant of [{ revokedAt: new Date("2026-10-01T00:00:00Z"), expiresAt: null }, { revokedAt: null, expiresAt: new Date("2026-10-25T00:00:00Z") }, null]) {
      mocks.grantFindUnique.mockResolvedValue(grant);
      expect((await post(componentBody)).status).toBe(403);
    }
    expect(mocks.createClubFormLink).not.toHaveBeenCalled();
  });

  it("refuses a form that is turned off", async () => {
    mocks.createClubFormLink.mockRejectedValue(new ClubFormError("TEMPLATE_NOT_FOUND", "That form isn't available."));
    const response = await post(componentBody);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
