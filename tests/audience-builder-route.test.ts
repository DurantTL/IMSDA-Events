import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") {
      super(message);
    }
  }
  return {
    AccessDeniedError: MockAccessDeniedError,
    requirePermission: vi.fn(),
    effectivePermissions: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    findActiveMembership: vi.fn(),
    previewEventAudience: vi.fn(),
    createAudienceSnapshot: vi.fn(),
    getAudienceFilterOptions: vi.fn(),
  };
});

vi.mock("@/modules/access/authorization", () => ({
  AccessDeniedError: mocks.AccessDeniedError,
  requirePermission: mocks.requirePermission,
  effectivePermissions: mocks.effectivePermissions,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/communications/message-files", () => ({ MessageFileError: class extends Error {} }));
vi.mock("@/modules/communications/messaging-repository", () => ({ MessagingError: class extends Error {} }));
vi.mock("@/modules/communications/audience-repository", async () => {
  const { z } = await import("zod");
  return {
    audiencePreviewRequestSchema: z.strictObject({
      query: z.unknown(),
      view: z.enum(["recipients", "exclusions"]).default("recipients"),
      page: z.strictObject({ limit: z.number().int().min(1).max(200).default(50), after: z.string().optional() }).optional(),
    }),
    previewEventAudience: mocks.previewEventAudience,
    createAudienceSnapshot: mocks.createAudienceSnapshot,
    getAudienceFilterOptions: mocks.getAudienceFilterOptions,
  };
});

import { GET, POST } from "@/app/api/events/[eventId]/audience/route";
import { AudienceFilterNotAvailableError } from "@/modules/communications/audience-query";

const context = { params: Promise.resolve({ eventId: "event-1" }) };
const snapshotId = "2d037129-32a3-4935-a4ce-b08a1d92cb6a";

function post(body: unknown) {
  return new Request("https://events.imsda.test/api/events/event-1/audience", {
    method: "POST",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "staff-1" }, membership: { role: "COMMUNICATIONS_MANAGER" } });
  mocks.effectivePermissions.mockReturnValue(["VIEW_EVENT", "MANAGE_COMMUNICATIONS"]);
  mocks.previewEventAudience.mockResolvedValue({ previewOnly: true, fingerprint: "a".repeat(64) });
  mocks.createAudienceSnapshot.mockResolvedValue({ snapshotId, replayed: false });
  mocks.getAudienceFilterOptions.mockResolvedValue({ filters: [] });
});

describe("audience builder route", () => {
  it("needs communications access for the filter list, preview and snapshot", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("The MANAGE_COMMUNICATIONS permission is required for this event."));
    expect((await GET(new Request("https://events.imsda.test/x"), context)).status).toBe(403);
    expect((await POST(post({ mode: "preview", query: {} }), context)).status).toBe(403);
    expect((await POST(post({ mode: "snapshot", snapshotId, query: {}, previewFingerprint: "a".repeat(64) }), context)).status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_COMMUNICATIONS", mocks.findActiveMembership);
    expect(mocks.previewEventAudience).not.toHaveBeenCalled();
    expect(mocks.createAudienceSnapshot).not.toHaveBeenCalled();
  });

  it("passes the caller's effective permissions, not the request, to the evaluator", async () => {
    const response = await POST(post({ mode: "preview", query: { tagIds: ["t1"] }, permissions: ["VIEW_SENSITIVE_DATA"] }), context);
    // An injected permissions field is a validation error, never trusted.
    expect(response.status).toBe(400);
    const ok = await POST(post({ mode: "preview", query: { tagIds: ["t1"] } }), context);
    expect(ok.status).toBe(200);
    expect(mocks.previewEventAudience).toHaveBeenCalledWith("event-1", ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"], expect.objectContaining({ query: { tagIds: ["t1"] } }));
  });

  it("answers an unavailable filter with one fixed 403 that reveals no value or count", async () => {
    mocks.previewEventAudience.mockRejectedValue(new AudienceFilterNotAvailableError());
    const response = await POST(post({ mode: "preview", query: { tagIds: ["secret-tag"] } }), context);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: "AUDIENCE_FILTER_NOT_AVAILABLE", message: "One of the audience filters is not available to you for this event." });
  });

  it("records a snapshot as the signed-in staff member and replays with 200", async () => {
    const created = await POST(post({ mode: "snapshot", snapshotId, query: {}, previewFingerprint: "a".repeat(64) }), context);
    expect(created.status).toBe(201);
    expect(mocks.createAudienceSnapshot).toHaveBeenCalledWith("event-1", "staff-1", ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"], expect.objectContaining({ snapshotId }));
    mocks.createAudienceSnapshot.mockResolvedValue({ snapshotId, replayed: true });
    expect((await POST(post({ mode: "snapshot", snapshotId, query: {}, previewFingerprint: "a".repeat(64) }), context)).status).toBe(200);
  });
});

describe("audience builder is preview-only", () => {
  const files = [
    "modules/communications/audience-query.ts",
    "modules/communications/audience-resolve.ts",
    "modules/communications/audience-repository.ts",
    "app/api/events/[eventId]/audience/route.ts",
  ].map((path) => [path, readFileSync(path, "utf8")] as const);

  it("never imports or calls anything that queues, sends or schedules", () => {
    for (const [path, source] of files) {
      expect(source, path).not.toMatch(/enqueue|transactional-messages|email-delivery|processPendingMessages|outbox-sweep/i);
      expect(source, path).not.toMatch(/messageOutbox\.(create|createMany|update|updateMany|upsert|delete)/);
    }
  });

  it("the loader names no protected source: no profile snapshot, answers, health, consent, notes or memberships", () => {
    const repository = files.find(([path]) => path.endsWith("audience-repository.ts"))![1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["profileSnapshot", "healthRecord", "HealthRecord", "staffNote", "StaffNote", "notes:", "eventMembership", "consent", "screening", "backgroundCheck", "allerg"]) {
      expect(repository, forbidden).not.toContain(forbidden);
    }
    // The only mention of form answers is the existence check, which never selects their content.
    expect(repository.match(/formResponses/g)?.length).toBe(1);
  });
});
