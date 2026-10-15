import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => {
  class MockAcknowledgmentError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly code = "FORBIDDEN", public readonly status = 403) {
      super(message);
    }
  }
  return {
    MockAcknowledgmentError,
    MockAccessDeniedError,
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    findActiveMembership: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    listRegistrationAcknowledgments: vi.fn(),
    recordStaffAcknowledgment: vi.fn(),
    getAcknowledgmentEvidencePayload: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("@/modules/access/authorization", () => ({
  requirePermission: dependencies.requirePermission,
  AccessDeniedError: dependencies.MockAccessDeniedError,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: dependencies.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: dependencies.findActiveMembership }));
vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: dependencies.logError }));
vi.mock("@/modules/acknowledgments/repository", () => ({
  AcknowledgmentError: dependencies.MockAcknowledgmentError,
  listRegistrationAcknowledgments: dependencies.listRegistrationAcknowledgments,
  recordStaffAcknowledgment: dependencies.recordStaffAcknowledgment,
  getAcknowledgmentEvidencePayload: dependencies.getAcknowledgmentEvidencePayload,
}));

import { GET as listAcknowledgments, POST as recordAcknowledgment } from "@/app/api/events/[eventId]/registrations/[registrationId]/acknowledgments/route";
import { GET as readEvidence } from "@/app/api/events/[eventId]/registrations/[registrationId]/acknowledgments/[evidenceId]/route";

const params = Promise.resolve({ eventId: "event-1", registrationId: "reg-1" });
const evidenceParams = Promise.resolve({ eventId: "event-1", registrationId: "reg-1", evidenceId: "ev-1" });
const REQUEST_ID = "00000000-0000-4000-8000-000000000150";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const valid = { fieldKey: "att_ack", attendeeId: "att-1", channel: "PAPER", clientRequestId: REQUEST_ID };

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
  dependencies.requirePermission.mockResolvedValue({ user: { id: "user-1" } });
  dependencies.rejectCrossOriginRequest.mockReturnValue(null);
});

describe("acknowledgment status route (#150)", () => {
  it("needs MANAGE_REGISTRATION on the event in the URL and returns status as of a moment, not cached", async () => {
    dependencies.listRegistrationAcknowledgments.mockResolvedValue([{ fieldKey: "att_ack", status: "ACKNOWLEDGED", evidence: [] }]);
    const response = await listAcknowledgments(new Request("http://localhost/api?at=2027-01-01T00:00:00.000Z"), { params });
    expect(response.status).toBe(200);
    expect(dependencies.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_REGISTRATION", dependencies.findActiveMembership);
    expect(dependencies.listRegistrationAcknowledgments).toHaveBeenCalledWith("event-1", "reg-1", new Date("2027-01-01T00:00:00.000Z"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).acknowledgments).toHaveLength(1);
  });

  it("defaults to now and refuses a malformed moment", async () => {
    dependencies.listRegistrationAcknowledgments.mockResolvedValue([]);
    await listAcknowledgments(new Request("http://localhost/api"), { params });
    expect(dependencies.listRegistrationAcknowledgments).toHaveBeenCalledWith("event-1", "reg-1", undefined);
    const bad = await listAcknowledgments(new Request("http://localhost/api?at=yesterday"), { params });
    expect(bad.status).toBe(400);
  });

  it("answers 404 for a registration that is not on the event", async () => {
    dependencies.listRegistrationAcknowledgments.mockResolvedValue(null);
    const response = await listAcknowledgments(new Request("http://localhost/api"), { params });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("REGISTRATION_NOT_FOUND");
  });

  it("denies a caller without the permission before reading anything", async () => {
    dependencies.requirePermission.mockRejectedValue(new dependencies.MockAccessDeniedError("No access.", "FORBIDDEN", 403));
    const response = await listAcknowledgments(new Request("http://localhost/api"), { params });
    expect(response.status).toBe(403);
    expect(dependencies.listRegistrationAcknowledgments).not.toHaveBeenCalled();
  });
});

describe("recording a staff-entered or paper acknowledgment (#150)", () => {
  const outcome = { evidence: { id: "ev-1" }, created: true, replayed: false };

  it("records under MANAGE_REGISTRATION, takes the staff user from the session, and answers 201", async () => {
    dependencies.recordStaffAcknowledgment.mockResolvedValue(outcome);
    const response = await recordAcknowledgment(post({ ...valid, acknowledgedAt: "2027-01-05T00:00:00.000Z" }, { "user-agent": "Synthetic/1.0" }), { params });
    expect(response.status).toBe(201);
    expect(dependencies.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_REGISTRATION", dependencies.findActiveMembership);
    const call = dependencies.recordStaffAcknowledgment.mock.calls[0]![0];
    expect(call).toMatchObject({
      eventId: "event-1", registrationId: "reg-1", fieldKey: "att_ack", attendeeId: "att-1", channel: "PAPER", actorUserId: "user-1", clientRequestId: REQUEST_ID,
      acknowledgedAt: new Date("2027-01-05T00:00:00.000Z"),
    });
    // Request metadata is approved keys only, and the user agent is a hash.
    expect(Object.keys(call.requestMetadata).sort()).toEqual(["submissionKey", "userAgentHash"]);
    expect(JSON.stringify(call.requestMetadata)).not.toContain("Synthetic/1.0");
    expect((await response.json()).evidence).toEqual({ id: "ev-1" });
  });

  it("answers 200 for a retry that returned the first result", async () => {
    dependencies.recordStaffAcknowledgment.mockResolvedValue({ evidence: { id: "ev-1" }, created: false, replayed: true });
    const response = await recordAcknowledgment(post(valid), { params });
    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
  });

  it("never lets the body name the staff user, the wording, or the form version", async () => {
    for (const extra of [{ actorUserId: "someone-else" }, { shownText: "Typed wording" }, { formVersionId: "other" }, { policyVersionId: "other" }]) {
      const response = await recordAcknowledgment(post({ ...valid, ...extra }), { params });
      expect(response.status).toBe(400);
    }
    expect(dependencies.recordStaffAcknowledgment).not.toHaveBeenCalled();
  });

  it.each([
    ["an online channel (staff cannot record that)", { channel: "ONLINE" }],
    ["a missing request id", { clientRequestId: undefined }],
    ["a request id that is not a UUID", { clientRequestId: "abc" }],
    ["a missing field key", { fieldKey: undefined }],
    ["a date that is not a date", { acknowledgedAt: "last week" }],
  ])("refuses %s", async (_label, overrides) => {
    const response = await recordAcknowledgment(post({ ...valid, ...overrides }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_ACKNOWLEDGMENT_REQUEST");
    expect(dependencies.recordStaffAcknowledgment).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request and a caller without the permission", async () => {
    dependencies.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await recordAcknowledgment(post(valid), { params })).status).toBe(403);
    expect(dependencies.requirePermission).not.toHaveBeenCalled();
    dependencies.rejectCrossOriginRequest.mockReturnValue(null);
    dependencies.requirePermission.mockRejectedValue(new dependencies.MockAccessDeniedError("No access.", "FORBIDDEN", 403));
    expect((await recordAcknowledgment(post(valid), { params })).status).toBe(403);
    expect(dependencies.recordStaffAcknowledgment).not.toHaveBeenCalled();
  });

  it.each([
    ["ACTING_FOR_MINOR_NOT_AUTHORIZED", 403],
    ["ACTING_FOR_ANOTHER_NOT_AUTHORIZED", 403],
    ["REGISTRATION_NOT_FOUND", 404],
    ["FIELD_NOT_FOUND", 404],
    ["ATTENDEE_NOT_FOUND", 404],
    ["ATTENDEE_REQUIRED", 400],
    ["ACKNOWLEDGED_AT_INVALID", 400],
    ["IDEMPOTENCY_CONFLICT", 409],
    ["FIELD_NOT_APPLICABLE", 409],
    ["POLICY_VERSION_UNAVAILABLE", 409],
  ])("maps %s to %i", async (code, status) => {
    dependencies.recordStaffAcknowledgment.mockRejectedValue(new dependencies.MockAcknowledgmentError(code, "Message."));
    const response = await recordAcknowledgment(post(valid), { params });
    expect(response.status).toBe(status);
    expect((await response.json()).error).toBe(code);
  });

  it("answers a failure the repository did not expect with a generic message and logs it without the request", async () => {
    dependencies.recordStaffAcknowledgment.mockRejectedValue(new Error("Invalid `prisma.acknowledgmentEvidence.createMany()` shownText: Synthetic wording"));
    const response = await recordAcknowledgment(post(valid), { params });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("ACKNOWLEDGMENT_REQUEST_FAILED");
    expect(JSON.stringify(body)).not.toContain("Synthetic wording");
    expect(dependencies.logError).toHaveBeenCalledWith("Acknowledgment request failed", expect.any(Error));
  });
});

describe("reading the payload behind one acknowledgment (#150)", () => {
  it("needs VIEW_SENSITIVE_DATA, is never cached, and reads through the registration that owns the evidence", async () => {
    dependencies.getAcknowledgmentEvidencePayload.mockResolvedValue({ evidence: { id: "ev-1" }, shownText: "Synthetic wording", policyVersion: null, requestMetadata: {} });
    const response = await readEvidence(new Request("http://localhost/api"), { params: evidenceParams });
    expect(response.status).toBe(200);
    expect(dependencies.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "VIEW_SENSITIVE_DATA", dependencies.findActiveMembership);
    expect(dependencies.getAcknowledgmentEvidencePayload).toHaveBeenCalledWith("event-1", "reg-1", "ev-1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("denies a caller without the sensitive-data permission and reads nothing", async () => {
    dependencies.requirePermission.mockRejectedValue(new dependencies.MockAccessDeniedError("No access.", "FORBIDDEN", 403));
    const response = await readEvidence(new Request("http://localhost/api"), { params: evidenceParams });
    expect(response.status).toBe(403);
    expect(dependencies.getAcknowledgmentEvidencePayload).not.toHaveBeenCalled();
  });

  it("answers 404 for evidence that is not this registration's", async () => {
    dependencies.getAcknowledgmentEvidencePayload.mockRejectedValue(new dependencies.MockAcknowledgmentError("EVIDENCE_NOT_FOUND", "That acknowledgment evidence was not found."));
    expect((await readEvidence(new Request("http://localhost/api"), { params: evidenceParams })).status).toBe(404);
  });
});
