import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/event-templates/from-event` and its preview (#154): signed-out, non-admin, cross-origin, invalid-input and
 * conflict handling. The repository is stubbed (its real error classes are kept) and the session is synthetic.
 */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  previewTemplateFromEvent: vi.fn(),
  saveTemplateFromEvent: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logError: mocks.logError };
});
vi.mock("@/modules/event-templates/from-event-repository", () => ({
  previewTemplateFromEvent: mocks.previewTemplateFromEvent,
  saveTemplateFromEvent: mocks.saveTemplateFromEvent,
}));

import { POST as previewRoute } from "@/app/api/event-templates/from-event/preview/route";
import { POST as saveRoute } from "@/app/api/event-templates/from-event/route";
import { EventTemplateOperationError } from "@/modules/event-templates/repository";
import { saveTemplateFromEventInputSchema } from "@/modules/event-templates/from-event-domain";

const staff = { id: "usr_synthetic_staff", email: "staff@imsda-events.test", displayName: "Synthetic Staff", globalRole: null };
const admin = { ...staff, id: "usr_synthetic_admin", globalRole: "SYSTEM_ADMIN" as const };
const origin = "https://events.imsda.test";

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/event-templates/from-event`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: requestOrigin },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validSave = {
  sourceEventId: "event-src", fingerprint: "a".repeat(64), releaseNote: "Reviewed after the retreat.", requestKey: "idempotency-key-0001",
  target: { mode: "NEW_VERSION", templateId: "template-1" },
};

const cases = [
  { label: "preview", call: (o?: string) => previewRoute(request({ sourceEventId: "event-src" }, o)), repository: mocks.previewTemplateFromEvent },
  { label: "save", call: (o?: string) => saveRoute(request(validSave, o)), repository: mocks.saveTemplateFromEvent },
];

beforeEach(() => {
  mocks.getCurrentSession.mockResolvedValue({ user: admin });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe.each(cases)("POST from-event $label", ({ call, repository }) => {
  it("rejects a signed-out request with 401", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call()).status).toBe(401);
    expect(repository).not.toHaveBeenCalled();
  });

  it("rejects a non-admin with 403", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: staff });
    const response = await call();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "PERMISSION_DENIED" });
    expect(repository).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request before the session is read", async () => {
    const response = await call("https://evil.example");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "INVALID_REQUEST_ORIGIN" });
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(repository).not.toHaveBeenCalled();
  });

  it("logs an unexpected failure and returns a generic 500", async () => {
    repository.mockRejectedValue(new Error("synthetic failure"));
    const response = await call();
    expect(response.status).toBe(500);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });
});

describe("POST from-event preview", () => {
  it("returns the preview for an admin and 404 for a missing event", async () => {
    mocks.previewTemplateFromEvent.mockResolvedValue({ fingerprint: "f" });
    const ok = await previewRoute(request({ sourceEventId: "event-src" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ preview: { fingerprint: "f" } });
    mocks.previewTemplateFromEvent.mockRejectedValue(new EventTemplateOperationError("SOURCE_NOT_FOUND", "That source event was not found."));
    expect((await previewRoute(request({ sourceEventId: "x" }))).status).toBe(404);
  });
});

describe("POST from-event save", () => {
  it("returns 201 for a new version and 200 for an idempotent retry", async () => {
    mocks.saveTemplateFromEvent.mockResolvedValueOnce({ template: { id: "template-1" }, versionId: "v2", versionNumber: 2, alreadySaved: false });
    const created = await saveRoute(request(validSave));
    expect(created.status).toBe(201);
    expect(mocks.saveTemplateFromEvent).toHaveBeenCalledWith("usr_synthetic_admin", validSave);
    mocks.saveTemplateFromEvent.mockResolvedValueOnce({ template: { id: "template-1" }, versionId: "v2", versionNumber: 2, alreadySaved: true });
    expect((await saveRoute(request(validSave))).status).toBe(200);
  });

  it("returns 400 for invalid input, using the real schema, without calling the repository twice", async () => {
    mocks.saveTemplateFromEvent.mockImplementation(async (_actor: string, body: unknown) => saveTemplateFromEventInputSchema.parse(body));
    const response = await saveRoute(request({ ...validSave, releaseNote: "" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "INVALID_TEMPLATE_FROM_EVENT" });
    expect((await saveRoute(request("{not json"))).status).toBe(400);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it.each([
    ["DRAFT_EXISTS", 409], ["SOURCE_CHANGED", 409], ["REQUEST_KEY_REUSED", 409], ["TEMPLATE_ARCHIVED", 409], ["AUDIENCE_MISMATCH", 409],
    ["TEMPLATE_NOT_FOUND", 404], ["SOURCE_NOT_FOUND", 404],
  ] as const)("maps %s to %i", async (code, status) => {
    mocks.saveTemplateFromEvent.mockRejectedValue(new EventTemplateOperationError(code, "conflict"));
    const response = await saveRoute(request(validSave));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: code });
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});
