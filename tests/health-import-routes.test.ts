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

  it("apply passes the chosen entry ids, or everything when asked", async () => {
    await applyRoute.POST(upload({ include: ["1001", "1003"] }));
    expect(state.apply.mock.calls[0]![2]).toEqual({ include: ["1001", "1003"] });
    await applyRoute.POST(upload({ includeAll: "true" }));
    expect(state.apply.mock.calls[1]![2]).toEqual({ include: null });
    await applyRoute.POST(upload());
    expect(state.apply.mock.calls[2]![2]).toEqual({ include: [] });
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
