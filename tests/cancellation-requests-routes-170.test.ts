import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #170: who may reach the request endpoints and the staff queue. A registrant reaches only the registration their
 * private link or signed-in account names, and never names a registration, an event, a status or an actor in the body.
 * Staff need MANAGE_FINANCE on the event in the URL. The workflow itself is mocked (cancellation-requests-workflow-170).
 * Synthetic data only.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirected"); }), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }), isServerEnvironmentError: () => false }));

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  resolveEventContext: vi.fn(),
  authorizeToken: vi.fn(),
  rateLimit: vi.fn(),
  getCurrentAttendee: vi.fn(),
  secondStepPending: vi.fn(),
  authorizeAttendeeRegistration: vi.fn(),
  service: {
    getRegistrantRequestView: vi.fn(),
    previewRegistrantRequest: vi.fn(),
    submitCancellationRequest: vi.fn(),
    withdrawCancellationRequest: vi.fn(),
    listCancellationRequests: vi.fn(),
    getCancellationRequestDetail: vi.fn(),
    reviewCancellationRequest: vi.fn(),
  },
}));

vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/public-access/repository", () => ({ authorizeRegistrationAccessToken: mocks.authorizeToken }));
vi.mock("@/modules/rate-limit/service", () => ({ checkPublicManageRateLimit: mocks.rateLimit }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ attendeeSecondStepPending: mocks.secondStepPending }));
vi.mock("@/modules/attendee-accounts/registrations-repository", () => ({ authorizeAttendeeRegistration: mocks.authorizeAttendeeRegistration }));
vi.mock("@/modules/cancellation-requests/repository", () => {
  class CancellationRequestError extends Error {
    constructor(public readonly code: string, message: string, public readonly detail?: Record<string, unknown>) { super(message); }
  }
  return { CancellationRequestError, ...mocks.service };
});

import { GET as manageGet, POST as managePost } from "@/app/api/public/manage/[token]/cancellation/route";
import { GET as portalGet, POST as portalPost } from "@/app/api/attendee/registrations/[registrationId]/cancellation/route";
import { GET as staffList } from "@/app/api/events/[eventId]/cancellation-requests/route";
import { GET as staffGet, POST as staffPost } from "@/app/api/events/[eventId]/cancellation-requests/[requestId]/route";
import CancellationRequestsPage from "@/app/(workspace)/finance/cancellation-requests/page";
import { CancellationRequestError } from "@/modules/cancellation-requests/repository";

const origin = "https://events.imsda.test";
const view = { available: true, unavailableReason: null, allowedScopes: ["FULL_REGISTRATION"], attendees: [], components: [], requests: [], hasOpenRequest: false };
const submit = { action: "submit", selection: { scope: "FULL_REGISTRATION" }, reason: "A family emergency.", contactMethod: "EMAIL", idempotencyKey: "key-12345678", expectedRefundCents: 1000 };

function post(body: unknown, headers: Record<string, string | null> = { origin }) {
  const clean = Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== null)) as Record<string, string>;
  return new Request("https://events.imsda.test/api/test", { method: "POST", headers: { "content-type": "application/json", ...clean }, body: JSON.stringify(body) });
}
const get = () => new Request("https://events.imsda.test/api/test");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-finance", globalRole: null, email: "f@example.test", displayName: "Fran Finance" } });
  mocks.findActiveMembership.mockImplementation(async (userId: string, eventId: string) => {
    if (eventId === "event-a") return { eventId, userId, role: "FINANCE_MANAGER", status: "ACTIVE", permissions: [] };
    if (eventId === "event-b") return { eventId, userId, role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: [] };
    return null;
  });
  mocks.authorizeToken.mockResolvedValue({ registrationId: "reg-from-token", eventId: "event-from-token" });
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1", verifiedEmail: "guest@example.test", displayName: "Guest" }, via: "attendee", sessionId: "s" });
  mocks.secondStepPending.mockResolvedValue(false);
  mocks.authorizeAttendeeRegistration.mockResolvedValue({ registrationId: "reg-own", eventId: "event-own" });
  mocks.service.getRegistrantRequestView.mockResolvedValue(view);
  mocks.service.previewRegistrantRequest.mockResolvedValue({ status: "CALCULATED" });
  mocks.service.submitCancellationRequest.mockResolvedValue({ request: { id: "req-1" }, duplicate: false, superseded: [] });
  mocks.service.withdrawCancellationRequest.mockResolvedValue({ id: "req-1", status: "WITHDRAWN" });
  mocks.service.listCancellationRequests.mockResolvedValue([]);
  mocks.service.getCancellationRequestDetail.mockResolvedValue({ id: "req-1" });
  mocks.service.reviewCancellationRequest.mockResolvedValue({ requestId: "req-1", status: "APPROVED" });
});

describe("the private manage link", () => {
  const context = (token = "tok") => ({ params: Promise.resolve({ token }) });

  it("answers an unknown or expired link with 404 and touches nothing", async () => {
    mocks.authorizeToken.mockResolvedValue(null);
    expect((await manageGet(get(), context())).status).toBe(404);
    expect((await managePost(post({ action: "preview", selection: { scope: "FULL_REGISTRATION" } }), context())).status).toBe(404);
    expect(mocks.service.getRegistrantRequestView).not.toHaveBeenCalled();
    expect(mocks.service.previewRegistrantRequest).not.toHaveBeenCalled();
  });

  it("takes the registration and event from the token, never from the body", async () => {
    const response = await managePost(post(submit), context());
    expect(response.status).toBe(201);
    expect(mocks.service.submitCancellationRequest).toHaveBeenCalledWith(
      { registrationId: "reg-from-token", eventId: "event-from-token" },
      { via: "MANAGE_LINK" },
      expect.objectContaining({ action: "submit", reason: "A family emergency." }),
    );
    for (const extra of [{ registrationId: "other" }, { eventId: "other" }, { status: "APPROVED" }, { actorUserId: "staff" }]) {
      mocks.service.submitCancellationRequest.mockClear();
      expect((await managePost(post({ ...submit, ...extra }), context())).status).toBe(400);
      expect(mocks.service.submitCancellationRequest).not.toHaveBeenCalled();
    }
  });

  it("returns 200, not 201, for a repeated submit", async () => {
    mocks.service.submitCancellationRequest.mockResolvedValue({ request: { id: "req-1" }, duplicate: true, superseded: [] });
    expect((await managePost(post(submit), context())).status).toBe(200);
  });

  it("rejects cross-origin and origin-less posts, and an oversize body", async () => {
    for (const headers of [{ origin: "https://evil.example" }, { origin: null }]) {
      expect((await managePost(post(submit, headers), context())).status).toBe(403);
    }
    const big = await managePost(post({ ...submit, reason: "x".repeat(9_000) }), context());
    expect(big.status).toBe(413);
    expect(mocks.service.submitCancellationRequest).not.toHaveBeenCalled();
  });

  it("refuses a declared length over the cap before reading the body", async () => {
    const declared = new Request("https://events.imsda.test/api/test", { method: "POST", headers: { "content-type": "application/json", origin, "content-length": "9000" }, body: JSON.stringify(submit) });
    const text = vi.spyOn(declared, "text");
    expect((await managePost(declared, context())).status).toBe(413);
    expect(text).not.toHaveBeenCalled();
    expect(mocks.service.submitCancellationRequest).not.toHaveBeenCalled();
  });

  it("is rate limited per link", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await managePost(post(submit), context())).status).toBe(429);
    expect((await manageGet(get(), context())).status).toBe(429);
    expect(mocks.service.submitCancellationRequest).not.toHaveBeenCalled();
  });

  it("turns the workflow's refusals into plain statuses and keeps the response private", async () => {
    mocks.service.submitCancellationRequest.mockRejectedValueOnce(new CancellationRequestError("OVERLAPPING_OPEN_REQUEST", "Open already.", { open: [{ id: "req-0" }] }));
    const overlap = await managePost(post(submit), context());
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toMatchObject({ error: "OVERLAPPING_OPEN_REQUEST", open: [{ id: "req-0" }] });
    expect(overlap.headers.get("cache-control")).toContain("no-store");
    mocks.service.submitCancellationRequest.mockRejectedValueOnce(new CancellationRequestError("CALCULATION_UNAVAILABLE", "Not on this registration."));
    expect((await managePost(post(submit), context())).status).toBe(422);
    mocks.service.withdrawCancellationRequest.mockRejectedValueOnce(new CancellationRequestError("REQUEST_NOT_FOUND", "No."));
    expect((await managePost(post({ action: "withdraw", requestId: "someone-elses" }), context())).status).toBe(404);
    mocks.service.submitCancellationRequest.mockRejectedValueOnce(new Error("database exploded with secret detail"));
    const failed = await managePost(post(submit), context());
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("secret detail");
  });
});

describe("the signed-in portal", () => {
  const context = (registrationId = "reg-own") => ({ params: Promise.resolve({ registrationId }) });

  it("needs a signed-in attendee, not a staff user and not a signed-out visitor", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await portalGet(get(), context())).status).toBe(401);
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "a", verifiedEmail: "x@example.test", displayName: "X" }, via: "staff", sessionId: null });
    expect((await portalPost(post(submit), context())).status).toBe(401);
    expect(mocks.service.submitCancellationRequest).not.toHaveBeenCalled();
  });

  it("holds the second sign-in step", async () => {
    mocks.secondStepPending.mockResolvedValue(true);
    expect((await portalPost(post(submit), context())).status).toBe(403);
    expect(mocks.service.submitCancellationRequest).not.toHaveBeenCalled();
  });

  it("answers a registration the account does not own with 404 before the workflow is touched", async () => {
    mocks.authorizeAttendeeRegistration.mockResolvedValue(null);
    expect((await portalGet(get(), context("reg-someone-else"))).status).toBe(404);
    expect((await portalPost(post(submit), context("reg-someone-else"))).status).toBe(404);
    expect(mocks.authorizeAttendeeRegistration).toHaveBeenCalledWith("guest@example.test", "reg-someone-else");
    expect(mocks.service.submitCancellationRequest).not.toHaveBeenCalled();
    expect(mocks.service.getRegistrantRequestView).not.toHaveBeenCalled();
  });

  it("submits for the owned registration as the account", async () => {
    expect((await portalPost(post(submit), context())).status).toBe(201);
    expect(mocks.service.submitCancellationRequest).toHaveBeenCalledWith(
      { registrationId: "reg-own", eventId: "event-own" },
      { via: "ATTENDEE_PORTAL", accountId: "account-1" },
      expect.objectContaining({ action: "submit" }),
    );
  });

  it("is rate limited per registration, with the manage link's limiter", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await portalPost(post(submit), context())).status).toBe(429);
    expect((await portalGet(get(), context())).status).toBe(429);
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.anything(), "account:reg-own", "update");
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.anything(), "account:reg-own", "read");
    expect(mocks.service.submitCancellationRequest).not.toHaveBeenCalled();
    expect(mocks.service.getRegistrantRequestView).not.toHaveBeenCalled();
  });

  it("refuses a declared length over the cap before reading the body", async () => {
    const declared = new Request("https://events.imsda.test/api/test", { method: "POST", headers: { "content-type": "application/json", origin, "content-length": "9000" }, body: JSON.stringify(submit) });
    const text = vi.spyOn(declared, "text");
    expect((await portalPost(declared, context())).status).toBe(413);
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin post", async () => {
    expect((await portalPost(post(submit, { origin: "https://evil.example" }), context())).status).toBe(403);
    expect(mocks.service.submitCancellationRequest).not.toHaveBeenCalled();
  });
});

describe("the staff endpoints", () => {
  const eventContext = (eventId = "event-a") => ({ params: Promise.resolve({ eventId }) });
  const requestContext = (eventId = "event-a", requestId = "req-1") => ({ params: Promise.resolve({ eventId, requestId }) });

  it("lets a finance manager list, read and decide for their event, as themselves", async () => {
    expect((await staffList(get(), eventContext())).status).toBe(200);
    expect(mocks.service.listCancellationRequests).toHaveBeenCalledWith("event-a", "OPEN");
    expect((await staffGet(get(), requestContext())).status).toBe(200);
    const approved = await staffPost(post({ action: "APPROVE", reason: "Within the policy." }), requestContext());
    expect(approved.status).toBe(200);
    expect(mocks.service.reviewCancellationRequest).toHaveBeenCalledWith("event-a", "req-1", { userId: "user-finance" }, { action: "APPROVE", reason: "Within the policy." });
  });

  it("refuses anyone without MANAGE_FINANCE on this event before the workflow is touched", async () => {
    for (const eventId of ["event-b", "event-unknown"]) {
      expect((await staffList(get(), eventContext(eventId))).status).toBe(403);
      expect((await staffGet(get(), requestContext(eventId))).status).toBe(403);
      expect((await staffPost(post({ action: "START_REVIEW" }), requestContext(eventId))).status).toBe(403);
    }
    expect(mocks.service.listCancellationRequests).not.toHaveBeenCalled();
    expect(mocks.service.getCancellationRequestDetail).not.toHaveBeenCalled();
    expect(mocks.service.reviewCancellationRequest).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await staffPost(post({ action: "START_REVIEW" }), requestContext())).status).toBe(401);
    expect(mocks.service.reviewCancellationRequest).not.toHaveBeenCalled();
  });

  it("will not take an actor, or a decision with no reason, or an automated action", async () => {
    for (const body of [
      { action: "APPROVE" },
      { action: "APPROVE", reason: "" },
      { action: "DECLINE", reason: "No.", actorUserId: "someone-else" },
      { action: "AUTO_APPROVE" },
      { action: "APPROVE_ALL", reason: "all" },
    ]) {
      expect((await staffPost(post(body), requestContext())).status).toBe(400);
    }
    expect(mocks.service.reviewCancellationRequest).not.toHaveBeenCalled();
  });

  it("rejects cross-origin posts", async () => {
    expect((await staffPost(post({ action: "START_REVIEW" }, { origin: "https://evil.example" }), requestContext())).status).toBe(403);
    expect((await staffPost(post({ action: "START_REVIEW" }, { origin: null }), requestContext())).status).toBe(403);
    expect(mocks.service.reviewCancellationRequest).not.toHaveBeenCalled();
  });

  it("answers a request of another event with 404 and a refused move with 409", async () => {
    mocks.service.getCancellationRequestDetail.mockResolvedValue(null);
    expect((await staffGet(get(), requestContext())).status).toBe(404);
    mocks.service.reviewCancellationRequest.mockRejectedValueOnce(new CancellationRequestError("CHANGES_NOT_ACKNOWLEDGED", "Changed.", { conflicts: [] }));
    expect((await staffPost(post({ action: "APPROVE", reason: "Yes." }), requestContext())).status).toBe(409);
  });
});

describe("the staff queue page", () => {
  const event = { id: "event-a", name: "Synthetic Camp", timezone: "America/Chicago" };

  it("shows the restricted notice and loads nothing without MANAGE_FINANCE", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_EVENT", "MANAGE_REGISTRATION"] });
    const markup = renderToStaticMarkup(await CancellationRequestsPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("Finance is restricted");
    expect(mocks.service.listCancellationRequests).not.toHaveBeenCalled();
    expect(mocks.service.getCancellationRequestDetail).not.toHaveBeenCalled();
  });

  it("renders the queue for a finance manager and says approving records the decision only", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_EVENT", "MANAGE_FINANCE"] });
    mocks.service.listCancellationRequests.mockResolvedValue([
      { id: "req-1", registrationId: "reg-1", confirmationCode: "SYN001", registrantName: "Avery Synthetic", status: "REQUESTED", statusLabel: "Requested", scope: "FULL_REGISTRATION", proposedRefundCents: 15_000, afterDeadline: true, createdAt: "2026-05-01T15:00:00.000Z", updatedAt: "2026-05-01T15:00:00.000Z" },
    ]);
    const markup = renderToStaticMarkup(await CancellationRequestsPage({ searchParams: Promise.resolve({ status: "nonsense" }) }));
    expect(mocks.service.listCancellationRequests).toHaveBeenCalledWith("event-a", "OPEN");
    expect(markup).toContain("Cancellation requests");
    expect(markup).toContain("Avery Synthetic");
    expect(markup).toContain("after deadline");
    expect(markup).toContain("Approving records your decision only");
  });
});
