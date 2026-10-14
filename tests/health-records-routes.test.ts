import { beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticRecord } from "./health-records-fixtures";

const state = vi.hoisted(() => ({
  enabled: false,
  viewerForClub: vi.fn(),
  staffViewer: vi.fn(),
  coordinatorViewer: vi.fn(),
  ackViewer: vi.fn(),
  recordAck: vi.fn(),
  repo: {
    viewHealthRecord: vi.fn(),
    saveHealthRecord: vi.fn(),
    confirmHealthRecord: vi.fn(),
    createHealthRecordLink: vi.fn(),
    listHealthRecordLinks: vi.fn(),
    revokeHealthRecordLink: vi.fn(),
    resolveHealthLinkForFill: vi.fn(),
    submitHealthRecordViaLink: vi.fn(),
  },
  rateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ HEALTH_RECORDS_ENABLED: state.enabled }) }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/club-rosters/access", () => ({
  RosterAccessError: class RosterAccessError extends Error {
    constructor(public readonly code: string, public readonly status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: vi.fn() }));
vi.mock("@/modules/health-records/access", () => ({
  requireHealthViewerForClub: state.viewerForClub,
  requireStaffHealthViewer: state.staffViewer,
  requireAreaCoordinatorHealthViewer: state.coordinatorViewer,
  resolveAcknowledgmentViewer: state.ackViewer,
}));
vi.mock("@/modules/health-records/acknowledgment", () => ({ recordHealthPrivacyAcknowledgment: state.recordAck }));
vi.mock("@/modules/health-records/repository", () => state.repo);
vi.mock("@/modules/rate-limit/service", () => ({ checkClubFormLinkRateLimit: state.rateLimit }));

import * as memberRoute from "@/app/api/attendee/clubs/[organizationId]/health/[memberId]/route";
import * as confirmRoute from "@/app/api/attendee/clubs/[organizationId]/health/[memberId]/confirm/route";
import * as linksRoute from "@/app/api/attendee/clubs/[organizationId]/health/[memberId]/links/route";
import * as linkRoute from "@/app/api/attendee/clubs/[organizationId]/health/[memberId]/links/[linkId]/route";
import * as coordinatorRoute from "@/app/api/attendee/area-clubs/health/[eventId]/[organizationId]/[memberId]/route";
import * as staffRoute from "@/app/api/staff/health-records/[organizationId]/[memberId]/route";
import * as publicRoute from "@/app/api/public/health-records/[token]/route";
import * as acknowledgmentRoute from "@/app/api/health-records/acknowledgment/route";
import { HEALTH_PRIVACY_ACK_VERSION } from "@/modules/health-records/acknowledgment-domain";
import { HealthRecordError } from "@/modules/health-records/errors";

const ctx = { params: Promise.resolve({ eventId: "event-1", organizationId: "club-a", memberId: "member-1", linkId: "link-1", token: "T".repeat(43), grantId: "grant-1" }) };

function request(method: string, body?: unknown) {
  return new Request("https://events.test/api/x", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
}

type Handler = (request: Request, context: typeof ctx) => Promise<Response>;

const allRoutes: Array<[string, Handler, string]> = [
  ["GET member", memberRoute.GET as unknown as Handler, "GET"],
  ["PUT member", memberRoute.PUT as unknown as Handler, "PUT"],
  ["POST confirm", confirmRoute.POST as unknown as Handler, "POST"],
  ["GET links", linksRoute.GET as unknown as Handler, "GET"],
  ["POST links", linksRoute.POST as unknown as Handler, "POST"],
  ["DELETE link", linkRoute.DELETE as unknown as Handler, "DELETE"],
  ["GET staff", staffRoute.GET as unknown as Handler, "GET"],
  ["GET coordinator", coordinatorRoute.GET as unknown as Handler, "GET"],
  ["GET public", publicRoute.GET as unknown as Handler, "GET"],
  ["POST public", publicRoute.POST as unknown as Handler, "POST"],
  ["POST acknowledgment", acknowledgmentRoute.POST as unknown as Handler, "POST"],
];

beforeEach(() => {
  state.enabled = false;
  for (const mock of [state.viewerForClub, state.staffViewer, state.coordinatorViewer, state.ackViewer, state.recordAck, state.rateLimit, ...Object.values(state.repo)]) mock.mockReset();
});

describe("with the feature off", () => {
  it.each(allRoutes)("%s answers 404 and reaches nothing", async (_name, handler, method) => {
    const response = await handler(request(method, method === "GET" || method === "DELETE" ? undefined : syntheticRecord), ctx);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "NOT_FOUND", message: "That page could not be found." });
    for (const mock of [state.viewerForClub, state.staffViewer, state.coordinatorViewer, state.ackViewer, state.recordAck, state.rateLimit, ...Object.values(state.repo)]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});

describe("with the feature on", () => {
  beforeEach(() => {
    state.enabled = true;
  });

  it("answers a Registrar's read with 403 and no record content, and lets their save through (#923)", async () => {
    const registrarViewer = { kind: "CLUB_REGISTRAR", organizationId: "club-a", accountId: "acct-reg" };
    state.viewerForClub.mockResolvedValue(registrarViewer);
    state.repo.viewHealthRecord.mockRejectedValue(new HealthRecordError("FORBIDDEN", "Registrars can enter a health record but cannot read, confirm or send links for one."));
    const read = await memberRoute.GET(request("GET"), ctx as never);
    expect(read.status).toBe(403);
    expect(JSON.stringify(await read.json())).not.toContain("values");
    state.repo.saveHealthRecord.mockResolvedValue({ recordId: "r1", status: "CURRENT" });
    const saved = await memberRoute.PUT(request("PUT", syntheticRecord), ctx as never);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ok: true, status: "CURRENT" });
    expect(state.repo.saveHealthRecord).toHaveBeenCalledWith(registrarViewer, "club-a", "member-1", syntheticRecord);
  });

  it("answers a Registrar's save over an existing record with 409 and the plain message only (#923)", async () => {
    state.viewerForClub.mockResolvedValue({ kind: "CLUB_REGISTRAR", organizationId: "club-a", accountId: "acct-reg" });
    state.repo.saveHealthRecord.mockRejectedValue(new HealthRecordError("RECORD_EXISTS", "A health record is already on file. The director or a deputy can update it."));
    const response = await memberRoute.PUT(request("PUT", syntheticRecord), ctx as never);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "RECORD_EXISTS", message: "A health record is already on file. The director or a deputy can update it." });
  });

  it("answers 403 with the acknowledgment code, and no record content, until the notice is acknowledged (#923)", async () => {
    for (const [route, setup] of [
      [memberRoute.GET, () => state.viewerForClub.mockResolvedValue({ kind: "CLUB_LEADER", organizationId: "club-a", accountId: "a" })],
      [staffRoute.GET, () => state.staffViewer.mockResolvedValue({ kind: "SYSTEM_ADMIN", userId: "u" })],
      [coordinatorRoute.GET, () => state.coordinatorViewer.mockResolvedValue({ kind: "AREA_COORDINATOR", accountId: "a" })],
    ] as const) {
      setup();
      state.repo.viewHealthRecord.mockRejectedValue(new HealthRecordError("ACKNOWLEDGMENT_REQUIRED", "Read and confirm the health information privacy notice before you continue."));
      const response = await (route as unknown as Handler)(request("GET"), ctx);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "ACKNOWLEDGMENT_REQUIRED" });
    }
  });

  it("records the acknowledgment for the signed-in person, only for the wording they were shown (#923)", async () => {
    state.ackViewer.mockResolvedValue({ kind: "CLUB_REGISTRAR", accountId: "acct-reg" });
    state.recordAck.mockResolvedValue({ version: HEALTH_PRIVACY_ACK_VERSION, alreadyAcknowledged: false });
    const ok = await acknowledgmentRoute.POST(request("POST", { as: "ATTENDEE", version: HEALTH_PRIVACY_ACK_VERSION }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, version: HEALTH_PRIVACY_ACK_VERSION });
    expect(state.ackViewer).toHaveBeenCalledWith("ATTENDEE");
    state.recordAck.mockClear();
    for (const body of [{ as: "ATTENDEE", version: "an-older-wording" }, { as: "ADMIN", version: HEALTH_PRIVACY_ACK_VERSION }, { as: "STAFF" }, { as: "STAFF", version: HEALTH_PRIVACY_ACK_VERSION, extra: 1 }]) {
      const bad = await acknowledgmentRoute.POST(request("POST", body));
      expect(bad.status).toBe(400);
    }
    expect(state.recordAck).not.toHaveBeenCalled();
  });

  it("refuses the acknowledgment to someone the notice is not for", async () => {
    state.ackViewer.mockRejectedValue(new HealthRecordError("FORBIDDEN", "Health records are for a club's director, deputy or Registrar, an Area Coordinator, or event health staff."));
    const response = await acknowledgmentRoute.POST(request("POST", { as: "ATTENDEE", version: HEALTH_PRIVACY_ACK_VERSION }));
    expect(response.status).toBe(403);
    expect(state.recordAck).not.toHaveBeenCalled();
  });

  it("maps a refused role to 403 without any record content", async () => {
    state.viewerForClub.mockRejectedValue(new HealthRecordError("FORBIDDEN", "Health records are for the club's director and deputy."));
    const response = await memberRoute.GET(request("GET"), ctx as never);
    expect(response.status).toBe(403);
    expect(state.repo.viewHealthRecord).not.toHaveBeenCalled();
  });

  it("denies the staff route to someone without the permission and never opens a record", async () => {
    state.staffViewer.mockRejectedValue(new HealthRecordError("FORBIDDEN", "Health records need the health information permission."));
    const response = await staffRoute.GET(request("GET"), ctx as never);
    expect(response.status).toBe(403);
    expect(state.repo.viewHealthRecord).not.toHaveBeenCalled();
  });

  it("sends the event id to the coordinator view and denies a non-coordinator without opening anything", async () => {
    state.coordinatorViewer.mockRejectedValueOnce(new HealthRecordError("NOT_FOUND", "That page could not be found."));
    const denied = await coordinatorRoute.GET(request("GET"), ctx as never);
    expect(denied.status).toBe(404);
    expect(state.repo.viewHealthRecord).not.toHaveBeenCalled();
    state.coordinatorViewer.mockResolvedValue({ kind: "AREA_COORDINATOR", accountId: "acct-coord" });
    state.repo.viewHealthRecord.mockResolvedValue({ status: "CURRENT", values: {} });
    const allowed = await coordinatorRoute.GET(request("GET"), ctx as never);
    expect(allowed.status).toBe(200);
    expect(state.repo.viewHealthRecord).toHaveBeenCalledWith(expect.objectContaining({ kind: "AREA_COORDINATOR" }), "club-a", "member-1", expect.any(Date), { eventId: "event-1" });
  });

  it("returns the opened record to a permitted viewer, uncacheable", async () => {
    state.viewerForClub.mockResolvedValue({ kind: "CLUB_LEADER", organizationId: "club-a", accountId: "acct-1" });
    state.repo.viewHealthRecord.mockResolvedValue({ status: "CURRENT", values: { medications: "Synthetic medication note" } });
    const response = await memberRoute.GET(request("GET"), ctx as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).health.status).toBe("CURRENT");
  });

  it("answers an invalid body with a generic message that does not echo the submitted values", async () => {
    state.viewerForClub.mockResolvedValue({ kind: "CLUB_LEADER", organizationId: "club-a", accountId: "acct-1" });
    state.repo.saveHealthRecord.mockRejectedValue(new HealthRecordError("VALIDATION_FAILED", "The emergency treatment authorization must be agreed to.", [{ field: "consentEmergencyTreatment", message: "The emergency treatment authorization must be agreed to." }]));
    const response = await memberRoute.PUT(request("PUT", syntheticRecord), ctx as never);
    expect(response.status).toBe(400);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("Synthetic");
    expect(text).not.toContain("Example Lane");
  });

  it("reports a malformed or oversized body as a 400 and logs nothing of it", async () => {
    state.viewerForClub.mockResolvedValue({ kind: "CLUB_LEADER", organizationId: "club-a", accountId: "acct-1" });
    const bad = await memberRoute.PUT(new Request("https://events.test/api/x", { method: "PUT", body: "{not json" }), ctx as never);
    expect(bad.status).toBe(400);
    const big = await memberRoute.PUT(new Request("https://events.test/api/x", { method: "PUT", body: "x".repeat(200_000) }), ctx as never);
    expect(big.status).toBe(400);
  });

  it("gives the public link route the same 404 for any unusable link and rate limits first", async () => {
    state.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
    state.repo.submitHealthRecordViaLink.mockRejectedValue(new HealthRecordError("LINK_UNAVAILABLE", "This private link is invalid or no longer active."));
    const response = await publicRoute.POST(request("POST", syntheticRecord), ctx as never);
    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe("This private link is invalid or no longer active.");
    expect(state.rateLimit).toHaveBeenCalled();
  });

  it("does not return the link or record id when a parent submits", async () => {
    state.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
    state.repo.submitHealthRecordViaLink.mockResolvedValue({ recordId: "record-secret-id" });
    const response = await publicRoute.POST(request("POST", syntheticRecord), ctx as never);
    expect(response.status).toBe(201);
    expect(JSON.stringify(await response.json())).not.toContain("record-secret-id");
  });
});
