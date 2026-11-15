import { beforeEach, describe, expect, it, vi } from "vitest";

// #182 slice 2: the approval routes check the origin and communications access, and map refusals to statuses.
const mocks = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") { super(message); }
  }
  class MockMessagingError extends Error {
    constructor(public readonly code: string, message: string, public readonly details?: Record<string, unknown>) { super(message); }
  }
  return {
    AccessDeniedError: MockAccessDeniedError,
    MessagingError: MockMessagingError,
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    listMessageApprovals: vi.fn(),
    getMessageApprovalReview: vi.fn(),
    approveMessage: vi.fn(),
    declineMessage: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/modules/access/authorization")>("@/modules/access/authorization");
  return { ...actual, AccessDeniedError: mocks.AccessDeniedError, requirePermission: mocks.requirePermission };
});
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: vi.fn() }));
vi.mock("@/modules/communications/messaging-error", () => ({ MessagingError: mocks.MessagingError }));
vi.mock("@/modules/bulk-actions/message-approvals", () => ({
  listMessageApprovals: mocks.listMessageApprovals,
  getMessageApprovalReview: mocks.getMessageApprovalReview,
  approveMessage: mocks.approveMessage,
  declineMessage: mocks.declineMessage,
}));

import { BulkActionError } from "@/modules/bulk-actions/domain";
import { GET as LIST } from "@/app/api/events/[eventId]/bulk-actions/messages/route";
import { GET as REVIEW } from "@/app/api/events/[eventId]/bulk-actions/messages/[approvalId]/route";
import { POST as APPROVE } from "@/app/api/events/[eventId]/bulk-actions/messages/[approvalId]/approve/route";
import { POST as DECLINE } from "@/app/api/events/[eventId]/bulk-actions/messages/[approvalId]/decline/route";

const post = (body: unknown) => new Request("https://events.example.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = () => new Request("https://events.example.test/api");
const event = { params: Promise.resolve({ eventId: "event-1" }) };
const approval = { params: Promise.resolve({ eventId: "event-1", approvalId: "approval-1" }) };
const FINGERPRINT = "c".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-b" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "user-b", email: "b@example.test", displayName: "Blake", globalRole: null }, membership: { eventId: "event-1", userId: "user-b", role: "COMMUNICATIONS_MANAGER", status: "ACTIVE", permissions: [] } });
});

describe("the message approval routes need communications access", () => {
  const denied = () => mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("Your event role doesn't include sending messages."));

  it("refuses everyone without it, on every route, before reading or sending anything", async () => {
    denied();
    expect((await LIST(get(), event)).status).toBe(403);
    expect((await REVIEW(get(), approval)).status).toBe(403);
    expect((await APPROVE(post({ previewFingerprint: FINGERPRINT }), approval)).status).toBe(403);
    expect((await DECLINE(post({}), approval)).status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_COMMUNICATIONS", expect.anything());
    for (const fn of [mocks.listMessageApprovals, mocks.getMessageApprovalReview, mocks.approveMessage, mocks.declineMessage]) expect(fn).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin approve or decline before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await APPROVE(post({ previewFingerprint: FINGERPRINT }), approval)).status).toBe(403);
    expect((await DECLINE(post({}), approval)).status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.approveMessage).not.toHaveBeenCalled();
    expect(mocks.declineMessage).not.toHaveBeenCalled();
  });
});

describe("list and review", () => {
  it("lists for the signed-in event and never caches", async () => {
    mocks.listMessageApprovals.mockResolvedValue({ pending: [], decided: [] });
    const response = await LIST(get(), event);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.listMessageApprovals).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1", userId: "user-b" }));
  });

  it("answers a review and a cross-event id as not found", async () => {
    mocks.getMessageApprovalReview.mockResolvedValue({ id: "approval-1", fingerprint: FINGERPRINT });
    expect(await (await REVIEW(get(), approval)).json()).toEqual({ review: { id: "approval-1", fingerprint: FINGERPRINT } });
    mocks.getMessageApprovalReview.mockRejectedValue(new BulkActionError("NOT_FOUND", "That queued message could not be found.", 404));
    expect((await REVIEW(get(), approval)).status).toBe(404);
  });
});

describe("approve and decline", () => {
  it("approves with the fingerprint the person was shown and the server's own viewer", async () => {
    mocks.approveMessage.mockResolvedValue({ id: "approval-1", status: "SENT", sendResult: null, replayed: false });
    const response = await APPROVE(post({ previewFingerprint: FINGERPRINT }), approval);
    expect(response.status).toBe(200);
    expect(mocks.approveMessage).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1", userId: "user-b" }), "approval-1", FINGERPRINT);
  });

  it("refuses a body without a fingerprint or with anything extra", async () => {
    expect((await APPROVE(post({}), approval)).status).toBe(400);
    expect((await APPROVE(post({ previewFingerprint: FINGERPRINT, userId: "user-z" }), approval)).status).toBe(400);
    expect(mocks.approveMessage).not.toHaveBeenCalled();
  });

  it("answers a changed review with 409 and the reason, without the recipients", async () => {
    mocks.approveMessage.mockRejectedValue(new mocks.MessagingError("PREVIEW_CHANGED", "These registrations changed since you reviewed them.", { selectedAudiencePreview: { recipients: [{ recipientEmail: "pat@example.test" }] } }));
    const response = await APPROVE(post({ previewFingerprint: FINGERPRINT }), approval);
    expect(response.status).toBe(409);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("PREVIEW_CHANGED");
    expect(body).not.toContain("example.test");
  });

  it("declines through the service", async () => {
    mocks.declineMessage.mockResolvedValue({ id: "approval-1", status: "DECLINED", sendResult: null, replayed: false });
    expect((await DECLINE(post({}), approval)).status).toBe(200);
    expect(mocks.declineMessage).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1" }), "approval-1");
    mocks.declineMessage.mockRejectedValue(new BulkActionError("ALREADY_DECIDED", "This message was already sent.", 409));
    expect((await DECLINE(post({}), approval)).status).toBe(409);
  });
});
