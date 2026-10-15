import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") {
      super(message);
    }
  }
  class MockStaffInvitationError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    AccessDeniedError: MockAccessDeniedError,
    StaffInvitationError: MockStaffInvitationError,
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    findActiveMembership: vi.fn(),
    checkRateLimit: vi.fn(),
    listInvitations: vi.fn(),
    previewInvitationImport: vi.fn(),
    confirmInvitationImport: vi.fn(),
    previewInvitationSend: vi.fn(),
    sendInvitations: vi.fn(),
    revokeInvitations: vi.fn(),
    copyInvitationLink: vi.fn(),
    reissueInvitation: vi.fn(),
    listApprovals: vi.fn(),
    approveRegistrations: vi.fn(),
    declineRegistrations: vi.fn(),
    submitInvitationRegistration: vi.fn(),
    retryMealCoverage: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/authorization", () => ({ AccessDeniedError: mocks.AccessDeniedError, requirePermission: mocks.requirePermission }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/rate-limit/service", () => ({ checkPublicRegistrationRateLimit: mocks.checkRateLimit }));
vi.mock("@/modules/staff-invitations/repository", () => ({
  StaffInvitationError: mocks.StaffInvitationError,
  staffInvitationErrorStatus: (code: string) => (code === "INVITATION_USED" ? 409 : code === "INVITATION_UNAVAILABLE" ? 410 : code === "REQUEST_TOO_LARGE" ? 413 : 400),
  listInvitations: mocks.listInvitations,
  previewInvitationImport: mocks.previewInvitationImport,
  confirmInvitationImport: mocks.confirmInvitationImport,
  previewInvitationSend: mocks.previewInvitationSend,
  sendInvitations: mocks.sendInvitations,
  revokeInvitations: mocks.revokeInvitations,
  copyInvitationLink: mocks.copyInvitationLink,
  reissueInvitation: mocks.reissueInvitation,
  listApprovals: mocks.listApprovals,
  approveRegistrations: mocks.approveRegistrations,
  declineRegistrations: mocks.declineRegistrations,
  submitInvitationRegistration: mocks.submitInvitationRegistration,
  retryMealCoverage: mocks.retryMealCoverage,
  APPROVAL_BATCH_MAX: 200,
}));

import { GET as LIST } from "@/app/api/events/[eventId]/staff-invitations/route";
import { POST as IMPORT } from "@/app/api/events/[eventId]/staff-invitations/import/route";
import { POST as ACTIONS } from "@/app/api/events/[eventId]/staff-invitations/actions/route";
import { POST as SEND } from "@/app/api/events/[eventId]/staff-invitations/send/route";
import { POST as ONE } from "@/app/api/events/[eventId]/staff-invitations/[invitationId]/route";
import { GET as APPROVALS, POST as DECIDE } from "@/app/api/events/[eventId]/staff-invitations/approvals/route";
import { readBoundedJson } from "@/modules/staff-invitations/api-errors";
import { POST as PUBLIC_SUBMIT } from "@/app/api/public/staff-invitations/[token]/route";

const event = { params: Promise.resolve({ eventId: "event-1" }) };
const one = { params: Promise.resolve({ eventId: "event-1", invitationId: "inv-1" }) };
const publicContext = { params: Promise.resolve({ token: "inv-1.token" }) };

function post(path: string, body: unknown) {
  return new Request(`https://events.imsda.test${path}`, {
    method: "POST",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "user-1" } });
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
});

describe("the staff routes (#804)", () => {
  it("require MANAGE_REGISTRATION to read the list and the approvals", async () => {
    mocks.listInvitations.mockResolvedValue({ rows: [], counts: {}, truncated: false });
    mocks.listApprovals.mockResolvedValue({ rows: [], counts: {} });
    expect((await LIST(new Request("https://events.imsda.test/x"), event)).status).toBe(200);
    expect((await APPROVALS(new Request("https://events.imsda.test/x"), event)).status).toBe(200);
    expect(mocks.requirePermission.mock.calls.map((call) => call[2])).toEqual(["MANAGE_REGISTRATION", "MANAGE_REGISTRATION"]);
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("No."));
    expect((await LIST(new Request("https://events.imsda.test/x"), event)).status).toBe(403);
    expect(mocks.listInvitations).toHaveBeenCalledTimes(1);
  });

  it("preview an import without creating anything, and confirm only with the preview's digest", async () => {
    mocks.previewInvitationImport.mockResolvedValue({ rows: [], counts: {}, willCreate: 0, digest: "a".repeat(32) });
    const previewed = await IMPORT(post("/i", { mode: "preview", csv: "email\na@example.test", defaultGroup: "STAFF" }), event);
    expect(previewed.status).toBe(200);
    expect(mocks.previewInvitationImport).toHaveBeenCalledWith("event-1", { csv: "email\na@example.test", defaultGroup: "STAFF" });
    expect(mocks.confirmInvitationImport).not.toHaveBeenCalled();

    const noDigest = await IMPORT(post("/i", { mode: "confirm", csv: "email\na@example.test", defaultGroup: "STAFF" }), event);
    expect(noDigest.status).toBe(400);
    const badGroup = await IMPORT(post("/i", { mode: "preview", csv: "email\na@example.test", defaultGroup: "BOSS" }), event);
    expect(badGroup.status).toBe(400);
    expect(mocks.confirmInvitationImport).not.toHaveBeenCalled();

    mocks.confirmInvitationImport.mockResolvedValue({ importBatchId: "b", created: 1, skipped: 0 });
    const confirmed = await IMPORT(post("/i", { mode: "confirm", csv: "email\na@example.test", defaultGroup: "STAFF", digest: "a".repeat(32) }), event);
    expect(confirmed.status).toBe(201);
    expect(mocks.confirmInvitationImport).toHaveBeenCalledWith("event-1", "user-1", expect.objectContaining({ digest: "a".repeat(32) }));
  });

  const digest = "b".repeat(32);

  it("make sending a bulk communication: it needs MANAGE_COMMUNICATIONS and the preview's digest", async () => {
    mocks.previewInvitationSend.mockResolvedValue({ willSend: 2, digest });
    mocks.sendInvitations.mockResolvedValue({ queued: 2, skipped: 0, deliveryMode: "LOCAL_CAPTURE" });
    expect((await SEND(post("/s", { action: "preview", ids: ["a", "b"] }), event)).status).toBe(200);
    expect((await SEND(post("/s", { action: "send", ids: ["a", "b"], digest }), event)).status).toBe(200);
    expect(mocks.requirePermission.mock.calls.map((call) => call[2])).toEqual(["MANAGE_COMMUNICATIONS", "MANAGE_COMMUNICATIONS"]);
    expect(mocks.sendInvitations).toHaveBeenCalledWith("event-1", "user-1", { ids: ["a", "b"], digest });
    // No digest, no send; a count in place of the digest is not accepted.
    expect((await SEND(post("/s", { action: "send", ids: ["a"] }), event)).status).toBe(400);
    expect((await SEND(post("/s", { action: "send", ids: ["a"], expectedCount: 1 }), event)).status).toBe(400);
    expect(mocks.sendInvitations).toHaveBeenCalledTimes(1);
  });

  it("check the permission before the body is read, and refuse a big body", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("No."));
    const unreadable = post("/s", { action: "send", ids: ["a"], digest });
    const text = vi.spyOn(unreadable, "text");
    const json = vi.spyOn(unreadable, "json");
    expect((await SEND(unreadable, event)).status).toBe(403);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(mocks.sendInvitations).not.toHaveBeenCalled();
    mocks.requirePermission.mockResolvedValue({ user: { id: "user-1" } });
    const big = await ACTIONS(post("/a", { action: "revoke", ids: ["a"], pad: "x".repeat(200_000) }), event);
    expect(big.status).toBe(413);
    expect(mocks.revokeInvitations).not.toHaveBeenCalled();
  });

  it("revoke with MANAGE_REGISTRATION only, and refuse send actions on that route", async () => {
    mocks.revokeInvitations.mockResolvedValue({ revoked: 1, skipped: 0 });
    expect((await ACTIONS(post("/a", { action: "revoke", ids: ["a"] }), event)).status).toBe(200);
    expect(mocks.requirePermission.mock.calls[0][2]).toBe("MANAGE_REGISTRATION");
    expect((await ACTIONS(post("/a", { action: "send", ids: ["a"], digest }), event)).status).toBe(400);
    expect((await ACTIONS(post("/a", { action: "revoke", ids: [] }), event)).status).toBe(400);
    expect(mocks.revokeInvitations).toHaveBeenCalledTimes(1);
  });

  it("refuse a cross-origin post before reading anything", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    for (const response of [
      await IMPORT(post("/i", { mode: "preview", csv: "x" }), event),
      await ACTIONS(post("/a", { action: "revoke", ids: ["a"] }), event),
      await SEND(post("/s", { action: "preview", ids: ["a"] }), event),
      await ONE(post("/o", { action: "copy" }), one),
      await DECIDE(post("/d", { decision: "APPROVE", ids: ["a"] }), event),
      await PUBLIC_SUBMIT(post("/p", {}), publicContext),
    ]) expect(response.status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.submitInvitationRegistration).not.toHaveBeenCalled();
  });

  it("copy or reissue one link, and nothing else", async () => {
    mocks.copyInvitationLink.mockResolvedValue({ url: "https://events.imsda.test/staff-invite/t" });
    mocks.reissueInvitation.mockResolvedValue({ url: "https://events.imsda.test/staff-invite/u" });
    expect(await (await ONE(post("/o", { action: "copy" }), one)).json()).toEqual({ result: { url: "https://events.imsda.test/staff-invite/t" } });
    expect(await (await ONE(post("/o", { action: "reissue" }), one)).json()).toEqual({ result: { url: "https://events.imsda.test/staff-invite/u" } });
    expect((await ONE(post("/o", { action: "send" }), one)).status).toBe(400);
    expect(mocks.copyInvitationLink).toHaveBeenCalledWith("event-1", "user-1", "inv-1");
  });

  it("approve or decline in one batch, and nothing else", async () => {
    mocks.approveRegistrations.mockResolvedValue({ decided: 2, skipped: 0, failed: 0 });
    mocks.declineRegistrations.mockResolvedValue({ decided: 1, skipped: 0, failed: 0 });
    expect((await DECIDE(post("/d", { decision: "APPROVE", ids: ["a", "b"] }), event)).status).toBe(200);
    expect((await DECIDE(post("/d", { decision: "DECLINE", ids: ["c"] }), event)).status).toBe(200);
    expect(mocks.approveRegistrations).toHaveBeenCalledWith("event-1", "user-1", ["a", "b"], { withoutMealCoverage: false });
    expect(mocks.declineRegistrations).toHaveBeenCalledWith("event-1", "user-1", ["c"]);
    expect((await DECIDE(post("/d", { decision: "DELETE", ids: ["c"] }), event)).status).toBe(400);
    expect((await DECIDE(post("/d", { decision: "APPROVE", ids: ["c"], extra: 1 }), event)).status).toBe(400);
  });

  it("pass the office's explicit choice to approve without meal coverage, retry meals, and cap the batch at 200", async () => {
    mocks.approveRegistrations.mockResolvedValue({ decided: 1, skipped: 0, failed: 0 });
    mocks.retryMealCoverage.mockResolvedValue({ decided: 1, skipped: 0, failed: 0 });
    await DECIDE(post("/d", { decision: "APPROVE", ids: ["a"] }), event);
    expect(mocks.approveRegistrations).toHaveBeenLastCalledWith("event-1", "user-1", ["a"], { withoutMealCoverage: false });
    await DECIDE(post("/d", { decision: "APPROVE", ids: ["a"], withoutMealCoverage: true }), event);
    expect(mocks.approveRegistrations).toHaveBeenLastCalledWith("event-1", "user-1", ["a"], { withoutMealCoverage: true });
    expect((await DECIDE(post("/d", { decision: "RETRY_MEALS", ids: ["a"] }), event)).status).toBe(200);
    expect(mocks.retryMealCoverage).toHaveBeenCalledWith("event-1", "user-1", ["a"]);
    expect((await DECIDE(post("/d", { decision: "DECLINE", ids: ["a"], withoutMealCoverage: true }), event)).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, index) => `id-${index}`);
    expect((await DECIDE(post("/d", { decision: "APPROVE", ids: many }), event)).status).toBe(400);
    expect((await DECIDE(post("/d", { decision: "APPROVE", ids: many.slice(0, 200) }), event)).status).toBe(200);
  });
});

describe("the public registration route (#804)", () => {
  const body = { firstName: "Ada", lastName: "Synthetic", dependants: [] };

  it("registers through the link and answers with the reference only", async () => {
    mocks.submitInvitationRegistration.mockResolvedValue({ confirmationCode: "REG-TEST", message: "Received." });
    const response = await PUBLIC_SUBMIT(post("/p", body), publicContext);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ confirmation: { confirmationCode: "REG-TEST", message: "Received." } });
    expect(mocks.submitInvitationRegistration).toHaveBeenCalledWith("inv-1.token", body);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("is rate limited, and too large a body is refused, before anything is saved", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await PUBLIC_SUBMIT(post("/p", body), publicContext)).status).toBe(429);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
    expect((await PUBLIC_SUBMIT(post("/p", { ...body, housingNote: "x".repeat(70_000) }), publicContext)).status).toBe(413);
    expect(mocks.submitInvitationRegistration).not.toHaveBeenCalled();
  });

  it("maps a link that does not work to the same refusal and never echoes the request", async () => {
    mocks.submitInvitationRegistration.mockRejectedValue(new mocks.StaffInvitationError("INVITATION_UNAVAILABLE", "This link isn't available."));
    const unavailable = await PUBLIC_SUBMIT(post("/p", { ...body, firstName: "Distinctive" }), publicContext);
    expect(unavailable.status).toBe(410);
    expect(JSON.stringify(await unavailable.json())).not.toContain("Distinctive");
    mocks.submitInvitationRegistration.mockRejectedValue(new mocks.StaffInvitationError("INVITATION_USED", "This link has already been used to register."));
    expect((await PUBLIC_SUBMIT(post("/p", body), publicContext)).status).toBe(409);
    const malformed = await PUBLIC_SUBMIT(post("/p", "{not json"), publicContext);
    expect(malformed.status).toBe(400);
  });
});

describe("bounded body reads (#804)", () => {
  function chunked(chunkCount: number, chunkBytes: number) {
    let sent = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= chunkCount) return controller.close();
        sent += 1;
        controller.enqueue(new TextEncoder().encode("x".repeat(chunkBytes)));
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("https://events.imsda.test/p", { method: "POST", headers: { origin: "https://events.imsda.test" }, body: stream, duplex: "half" } as RequestInit);
    return { request, sentChunks: () => sent, wasCancelled: () => cancelled };
  }

  it("stops reading a chunked body with no Content-Length once it is over the cap, and cancels it", async () => {
    const body = chunked(1000, 1024);
    expect(body.request.headers.get("content-length")).toBeNull();
    await expect(readBoundedJson(body.request, 4096)).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
    expect(body.wasCancelled()).toBe(true);
    expect(body.sentChunks()).toBeLessThan(20);
  });

  it("reads a chunked body that fits, and the public route refuses an oversized chunked one with 413", async () => {
    const ok = chunked(2, 8);
    await expect(readBoundedJson(ok.request, 4096)).rejects.toBeInstanceOf(SyntaxError);
    const big = chunked(200, 1024);
    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    expect((await PUBLIC_SUBMIT(big.request, publicContext)).status).toBe(413);
    expect(big.wasCancelled()).toBe(true);
    expect(mocks.submitInvitationRegistration).not.toHaveBeenCalled();
  });
});
