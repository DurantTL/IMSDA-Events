import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The conference club order routes (#1688) behind the real roster gate for the club side (the same gate as the club Orders screen:
 * only the lookups underneath and the order storage are stubbed) and behind the Clubs Administration gate for the staff side.
 */
const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  findEnrollment: vi.fn(),
  findSession: vi.fn(),
  countPasskeys: vi.fn(),
  findSettings: vi.fn(),
  findAreaGrant: vi.fn(),
  findOrganization: vi.fn(),
  staffActing: vi.fn(),
  crossOrigin: vi.fn(),
  loadClubConferenceOrders: vi.fn(),
  submitConferenceOrder: vi.fn(),
  cancelConferenceOrderAsDirector: vi.fn(),
  loadConferenceOrdersForStaff: vi.fn(),
  fillConferenceOrder: vi.fn(),
  cancelConferenceOrderAsStaff: vi.fn(),
  requireClubsAdministration: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: async () => "OK" }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    attendeeMfaEnrollment: { findUnique: mocks.findEnrollment },
    attendeeSession: { findUnique: mocks.findSession },
    attendeePasskey: { count: mocks.countPasskeys },
    platformSettings: { findUnique: mocks.findSettings },
    areaCoordinatorGrant: { findUnique: mocks.findAreaGrant },
    organization: { findUnique: mocks.findOrganization },
  }),
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: () => mocks.staffActing() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: (request: Request) => mocks.crossOrigin(request) }));
vi.mock("@/modules/organizations/access", () => ({ requireClubsAdministration: () => mocks.requireClubsAdministration() }));
vi.mock("@/modules/club-orders/conference-repository", () => ({
  loadClubConferenceOrders: mocks.loadClubConferenceOrders,
  submitConferenceOrder: mocks.submitConferenceOrder,
  cancelConferenceOrderAsDirector: mocks.cancelConferenceOrderAsDirector,
  loadConferenceOrdersForStaff: mocks.loadConferenceOrdersForStaff,
  fillConferenceOrder: mocks.fillConferenceOrder,
  cancelConferenceOrderAsStaff: mocks.cancelConferenceOrderAsStaff,
}));

import { GET, POST } from "@/app/api/attendee/clubs/[organizationId]/orders/conference/route";
import { POST as POST_CANCEL } from "@/app/api/attendee/clubs/[organizationId]/orders/conference/[orderId]/cancel/route";
import { GET as GET_STAFF } from "@/app/api/admin/conference-club-orders/route";
import { POST as POST_FILL } from "@/app/api/admin/conference-club-orders/[orderId]/fill/route";
import { POST as POST_STAFF_CANCEL } from "@/app/api/admin/conference-club-orders/[orderId]/cancel/route";
import { AccessDeniedError } from "@/modules/access/authorization";
import { ClubOrderError } from "@/modules/club-orders/repository";

const clubFor = (organizationId: string, role: string) => ({ organizationId, name: "Test Pathfinders", role, sponsoringChurch: null });
const account = { id: "director-1", verifiedEmail: "director@example.test", displayName: "Test Director" };
const ctx = (organizationId = "club-1") => ({ params: Promise.resolve({ organizationId }) });
const cancelCtx = (organizationId = "club-1", orderId = "order-1") => ({ params: Promise.resolve({ organizationId, orderId }) });
const staffCtx = (orderId = "order-1") => ({ params: Promise.resolve({ orderId }) });
const post = (body: unknown) => new Request("https://events.imsda.test/api/x", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const get = () => new Request("https://events.imsda.test/api/x");
const order = { quantities: { "item-1": 20, "item-2": "4" }, patchesToExchange: 7 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account, via: "attendee", sessionId: "session-1" });
  mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", "DIRECTOR")]);
  mocks.findEnrollment.mockResolvedValue({ status: "ACTIVE" });
  mocks.findSession.mockResolvedValue({ secondFactorVerifiedAt: new Date(Date.now() - 60_000) });
  mocks.countPasskeys.mockResolvedValue(0);
  mocks.findSettings.mockResolvedValue({ passkeyRpId: null });
  mocks.findAreaGrant.mockResolvedValue(null);
  mocks.findOrganization.mockResolvedValue({ type: "CLUB", isActive: true });
  mocks.staffActing.mockResolvedValue(null);
  mocks.crossOrigin.mockReturnValue(null);
  mocks.loadClubConferenceOrders.mockResolvedValue({ items: [], churchName: "Sample Church", orders: [] });
  mocks.submitConferenceOrder.mockResolvedValue({ id: "order-1", status: "SUBMITTED" });
  mocks.cancelConferenceOrderAsDirector.mockResolvedValue({ orderId: "order-1" });
  mocks.loadConferenceOrdersForStaff.mockResolvedValue({ orders: [], bills: [], items: [] });
  mocks.fillConferenceOrder.mockResolvedValue({ orderId: "order-1", eventId: "event-1", invoiceId: "invoice-1", invoiceOutcome: "CREATED", addedToStock: false });
  mocks.cancelConferenceOrderAsStaff.mockResolvedValue({ orderId: "order-1" });
  mocks.requireClubsAdministration.mockResolvedValue({ id: "staff-1", globalRole: "STAFF" });
});

describe("club side: a director submits and cancels their own club's conference order", () => {
  it.each(["DIRECTOR", "DEPUTY"])("a %s submits an order, as themselves", async (role) => {
    mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", role)]);
    const response = await POST(post(order), ctx());
    expect(response.status).toBe(201);
    expect(mocks.submitConferenceOrder).toHaveBeenCalledWith("club-1", order, { accountId: "director-1" });
  });

  it("a director cancels their club's order", async () => {
    const response = await POST_CANCEL(post({}), cancelCtx());
    expect(response.status).toBe(200);
    expect(mocks.cancelConferenceOrderAsDirector).toHaveBeenCalledWith("club-1", "order-1", { accountId: "director-1" });
  });

  it("another club's director is refused with 404 and nothing runs (submit, cancel and view)", async () => {
    expect((await POST(post(order), ctx("club-2"))).status).toBe(404);
    expect((await POST_CANCEL(post({}), cancelCtx("club-2"))).status).toBe(404);
    expect((await GET(get(), ctx("club-2"))).status).toBe(404);
    expect(mocks.submitConferenceOrder).not.toHaveBeenCalled();
    expect(mocks.cancelConferenceOrderAsDirector).not.toHaveBeenCalled();
    expect(mocks.loadClubConferenceOrders).not.toHaveBeenCalled();
  });

  it("a registrar can view but not submit or cancel", async () => {
    mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", "REGISTRAR")]);
    const read = await GET(get(), ctx());
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ canEdit: false });
    expect((await POST(post(order), ctx())).status).toBe(403);
    expect((await POST_CANCEL(post({}), cancelCtx())).status).toBe(403);
    expect(mocks.submitConferenceOrder).not.toHaveBeenCalled();
    expect(mocks.cancelConferenceOrderAsDirector).not.toHaveBeenCalled();
  });

  it("an Area Coordinator is refused like any non-member, and a signed-out request is 401", async () => {
    mocks.listDirectedClubs.mockResolvedValue([]);
    mocks.findAreaGrant.mockResolvedValue({ revokedAt: null, expiresAt: null });
    expect((await GET(get(), ctx())).status).toBe(404);
    expect((await POST(post(order), ctx())).status).toBe(404);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await GET(get(), ctx())).status).toBe(401);
    expect((await POST(post(order), ctx())).status).toBe(401);
    expect(mocks.submitConferenceOrder).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin submit and a malformed body", async () => {
    mocks.crossOrigin.mockReturnValueOnce(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await POST(post(order), ctx())).status).toBe(403);
    for (const body of [{}, { quantities: { "item-1": [1] } }, { quantities: {}, extra: true }, { quantities: { "item-1": 1 }, patchesToExchange: {} }]) {
      expect((await POST(post(body), ctx())).status).toBe(400);
    }
    expect(mocks.submitConferenceOrder).not.toHaveBeenCalled();
  });

  it("tells a club with no sponsoring church to contact the youth department, and keeps the refusal plain", async () => {
    mocks.submitConferenceOrder.mockRejectedValue(new ClubOrderError("NO_SPONSORING_CHURCH", "This club has no sponsoring church on file, so it can't order from the conference yet. Contact the youth department to add one."));
    const response = await POST(post(order), ctx());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "NO_SPONSORING_CHURCH", message: expect.stringContaining("Contact the youth department") });
  });

  it("answers a cancel after the order was filled with a conflict", async () => {
    mocks.cancelConferenceOrderAsDirector.mockRejectedValue(new ClubOrderError("ORDER_NOT_SUBMITTED", "This order can't be cancelled here any more. Contact the youth department."));
    expect((await POST_CANCEL(post({}), cancelCtx())).status).toBe(409);
    mocks.cancelConferenceOrderAsDirector.mockRejectedValue(new ClubOrderError("ORDER_NOT_FOUND", "That order could not be found."));
    expect((await POST_CANCEL(post({}), cancelCtx())).status).toBe(404);
  });
});

describe("staff side: youth department staff fill and cancel (Clubs Administration only)", () => {
  const denied = () => new AccessDeniedError("Clubs Administrator or system administrator access is required.", 403, "PERMISSION_DENIED");

  it("a Clubs Administrator lists, fills with postage and cancels with a reason, as themselves", async () => {
    expect((await GET_STAFF(get())).status).toBe(200);
    const filled = await POST_FILL(post({ postage: "4.50", addToStock: true }), staffCtx());
    expect(filled.status).toBe(200);
    expect(mocks.fillConferenceOrder).toHaveBeenCalledWith("order-1", { postage: "4.50", addToStock: true }, "staff-1");
    expect((await POST_STAFF_CANCEL(post({ reason: "Duplicate order" }), staffCtx())).status).toBe(200);
    expect(mocks.cancelConferenceOrderAsStaff).toHaveBeenCalledWith("order-1", "Duplicate order", "staff-1");
  });

  it("anyone without Clubs Administration is refused on every staff route and nothing runs", async () => {
    mocks.requireClubsAdministration.mockRejectedValue(denied());
    expect((await GET_STAFF(get())).status).toBe(403);
    expect((await POST_FILL(post({ postage: "1", addToStock: false }), staffCtx())).status).toBe(403);
    expect((await POST_STAFF_CANCEL(post({ reason: "x" }), staffCtx())).status).toBe(403);
    expect(mocks.loadConferenceOrdersForStaff).not.toHaveBeenCalled();
    expect(mocks.fillConferenceOrder).not.toHaveBeenCalled();
    expect(mocks.cancelConferenceOrderAsStaff).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin change, unknown fields, and a missing reason shape", async () => {
    mocks.crossOrigin.mockReturnValueOnce(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await POST_FILL(post({ postage: "1" }), staffCtx())).status).toBe(403);
    expect((await POST_FILL(post({ postage: "1", addToStock: false, status: "FILLED" }), staffCtx())).status).toBe(400);
    expect((await POST_STAFF_CANCEL(post({}), staffCtx())).status).toBe(400);
    expect(mocks.fillConferenceOrder).not.toHaveBeenCalled();
    expect(mocks.cancelConferenceOrderAsStaff).not.toHaveBeenCalled();
  });

  it("maps bad postage and a missing reason to 400 and a filled order to 409", async () => {
    mocks.fillConferenceOrder.mockRejectedValue(new ClubOrderError("INVALID_POSTAGE", "Enter the postage in dollars and cents."));
    expect((await POST_FILL(post({ postage: "abc", addToStock: false }), staffCtx())).status).toBe(400);
    mocks.fillConferenceOrder.mockRejectedValue(new ClubOrderError("ORDER_NOT_SUBMITTED", "Only a submitted order can be filled."));
    expect((await POST_FILL(post({ postage: "1", addToStock: false }), staffCtx())).status).toBe(409);
    mocks.cancelConferenceOrderAsStaff.mockRejectedValue(new ClubOrderError("REASON_REQUIRED", "Give a reason."));
    expect((await POST_STAFF_CANCEL(post({ reason: " " }), staffCtx())).status).toBe(400);
  });
});
