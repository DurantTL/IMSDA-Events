import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAIN_HEADERS, csvBytes, mainRow } from "./health-import-fixtures";

const state = vi.hoisted(() => ({
  enabled: false,
  staffViewer: vi.fn(),
  originError: null as Response | null,
  preview: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ HEALTH_RECORDS_ENABLED: state.enabled }) }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => state.originError }));
vi.mock("@/modules/health-records/access", () => ({ requireStaffHealthViewer: state.staffViewer }));
vi.mock("@/modules/health-records/import-repository", () => ({ previewHealthImport: state.preview, applyHealthImport: state.apply }));

import * as applyRoute from "@/app/api/staff/health-import/apply/route";
import * as previewRoute from "@/app/api/staff/health-import/preview/route";
import { HealthRecordError } from "@/modules/health-records/errors";

function upload(extra: Record<string, string | string[]> = {}, file: Uint8Array = csvBytes(MAIN_HEADERS, [mainRow()])) {
  const form = new FormData();
  form.append("file", new Blob([file as BlobPart], { type: "text/csv" }), "export.csv");
  for (const [key, value] of Object.entries(extra)) for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  return new Request("https://events.test/api/staff/health-import/preview", { method: "POST", body: form });
}

const routes = [["preview", previewRoute.POST], ["apply", applyRoute.POST]] as const;

beforeEach(() => {
  state.enabled = true;
  state.originError = null;
  for (const mock of [state.staffViewer, state.preview, state.apply]) mock.mockReset();
  state.staffViewer.mockResolvedValue({ kind: "SYSTEM_ADMIN", userId: "admin-1" });
  state.preview.mockResolvedValue({ rows: [], counts: {}, total: 0 });
  state.apply.mockResolvedValue({ runId: "run-1", rows: [], counts: {}, imported: 0 });
});

describe("the health import routes", () => {
  it.each(routes)("%s answers 404 and reads nothing with the feature off", async (_name, handler) => {
    state.enabled = false;
    const response = await handler(upload());
    expect(response.status).toBe(404);
    expect(state.staffViewer).not.toHaveBeenCalled();
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.apply).not.toHaveBeenCalled();
  });

  it.each(routes)("%s refuses a cross-origin request before anything else", async (_name, handler) => {
    state.originError = Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 });
    expect((await handler(upload())).status).toBe(403);
    expect(state.staffViewer).not.toHaveBeenCalled();
  });

  it.each(routes)("%s passes a refusal for a non-administrator through and never parses their file", async (_name, handler) => {
    state.staffViewer.mockRejectedValue(new HealthRecordError("FORBIDDEN", "Health records need the health information permission."));
    const response = await handler(upload());
    expect(response.status).toBe(403);
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.apply).not.toHaveBeenCalled();
  });

  it("preview hands the uploaded bytes to the importer and sends the answer uncached", async () => {
    const response = await previewRoute.POST(upload());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const [viewer, files] = state.preview.mock.calls[0]!;
    expect(viewer).toMatchObject({ kind: "SYSTEM_ADMIN" });
    expect(files).toHaveLength(1);
    expect(new TextDecoder().decode(files[0].bytes)).toContain("PathfinderHealthRecord_Id");
  });

  it("apply passes the chosen sourceId:memberId pairs, and nothing is selected by default", async () => {
    await applyRoute.POST(upload({ include: ["1001:member-1", "1003:member-3", "broken", ":x", "y:"] }));
    expect(state.apply.mock.calls[0]![2]).toEqual({ include: [{ sourceId: "1001", memberId: "member-1" }, { sourceId: "1003", memberId: "member-3" }] });
    await applyRoute.POST(upload({ includeAll: "true" }));
    expect(state.apply.mock.calls[1]![2]).toEqual({ include: [] });
    await applyRoute.POST(upload());
    expect(state.apply.mock.calls[2]![2]).toEqual({ include: [] });
  });

  it.each(routes)("%s refuses staff who are not system administrators before reading the upload", async (_name, handler) => {
    for (const viewer of [
      { kind: "HEALTH_ROLE", userId: "staff-1", eventIds: ["event-1"] },
      { kind: "SYSTEM_ADMIN", userId: "admin-1", actAsId: "director-1" },
      { kind: "CLUB_LEADER", organizationId: "club-a", accountId: "a" },
    ]) {
      state.staffViewer.mockResolvedValue(viewer);
      // A request whose body would throw if anything tried to read it.
      const request = new Request("https://events.test/x", { method: "POST", body: "x", headers: { "content-type": "multipart/form-data; boundary=zzz" } });
      const formData = vi.spyOn(request, "formData");
      const response = await handler(request);
      expect(response.status).toBe(403);
      expect(formData).not.toHaveBeenCalled();
    }
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.apply).not.toHaveBeenCalled();
  });

  it.each(routes)("%s passes a missing privacy acknowledgment through as a refusal", async (_name, handler) => {
    const refusal = new HealthRecordError("ACKNOWLEDGMENT_REQUIRED", "Read and confirm the health information privacy notice before you continue.");
    state.preview.mockRejectedValue(refusal);
    state.apply.mockRejectedValue(refusal);
    const response = await handler(upload());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "ACKNOWLEDGMENT_REQUIRED" });
  });

  it.each(routes)("%s answers an unauthenticated request as refused, reading nothing", async (_name, handler) => {
    state.staffViewer.mockRejectedValue(Object.assign(new Error("Authentication is required."), { name: "AccessDeniedError" }));
    const response = await handler(upload());
    expect([401, 403, 500]).toContain(response.status);
    expect(state.preview).not.toHaveBeenCalled();
  });

  it.each(routes)("%s says so when no file is sent, without echoing anything", async (_name, handler) => {
    state.preview.mockRejectedValue(new HealthRecordError("VALIDATION_FAILED", "Choose the Cognito export file first."));
    state.apply.mockRejectedValue(new HealthRecordError("VALIDATION_FAILED", "Choose the Cognito export file first."));
    const response = await handler(new Request("https://events.test/x", { method: "POST", body: new FormData() }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "VALIDATION_FAILED" });
  });

  it.each(routes)("%s answers a body that is not an upload with a fixed message", async (_name, handler) => {
    const response = await handler(new Request("https://events.test/x", { method: "POST", body: "Synthetic peanut reaction", headers: { "content-type": "text/plain" } }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toMatch(/peanut/);
  });
});
