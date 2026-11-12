import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  findActiveMembership: vi.fn(),
  getCurrentSession: vi.fn(),
  listLibraryImages: vi.fn(),
  listLibraryTags: vi.fn(),
  addUploadToLibrary: vi.fn(),
  getLibraryImageRecord: vi.fn(),
  updateLibraryImageTags: vi.fn(),
  setLibraryImageRetired: vi.fn(),
  applyLibraryImageToEvent: vi.fn(),
  findLibraryImageFile: vi.fn(),
  listEventAssets: vi.fn(),
  eventAssetResponse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: dependencies.findActiveMembership }));
vi.mock("@/modules/events/asset-repository", () => ({ listEventAssets: dependencies.listEventAssets }));
vi.mock("@/modules/events/asset-response", () => ({ eventAssetResponse: dependencies.eventAssetResponse }));
vi.mock("@/modules/events/image-library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/events/image-library")>();
  return {
    ...actual,
    listLibraryImages: dependencies.listLibraryImages,
    listLibraryTags: dependencies.listLibraryTags,
    addUploadToLibrary: dependencies.addUploadToLibrary,
    getLibraryImageRecord: dependencies.getLibraryImageRecord,
    updateLibraryImageTags: dependencies.updateLibraryImageTags,
    setLibraryImageRetired: dependencies.setLibraryImageRetired,
    applyLibraryImageToEvent: dependencies.applyLibraryImageToEvent,
    findLibraryImageFile: dependencies.findLibraryImageFile,
  };
});

import { GET as listRoute, POST as uploadRoute } from "@/app/api/events/[eventId]/image-library/route";
import { PATCH as patchRoute } from "@/app/api/events/[eventId]/image-library/[imageId]/route";
import { POST as chooseRoute } from "@/app/api/events/[eventId]/image-library/[imageId]/use/route";
import { GET as fileRoute } from "@/app/api/events/[eventId]/image-library/[imageId]/file/route";
import { ImageLibraryError } from "@/modules/events/image-library";

const eventId = "event_1";
const imageId = "img_1";
const origin = "https://events.imsda.test";
const base = `/api/events/${eventId}/image-library`;

function request(path: string, method: string, body?: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, { method, headers: { origin, ...headers }, body });
}

const listParams = { params: Promise.resolve({ eventId }) };
const imageParams = { params: Promise.resolve({ eventId, imageId }) };

const routeCases: Array<{ name: string; call: () => Promise<Response> }> = [
  { name: "GET list", call: () => listRoute(request(base, "GET"), listParams) },
  { name: "POST upload", call: () => uploadRoute(request(base, "POST", new FormData(), { "content-length": "100" }), listParams) },
  { name: "PATCH image", call: () => patchRoute(request(`${base}/${imageId}`, "PATCH", JSON.stringify({ retired: true }), { "content-type": "application/json" }), imageParams) },
  { name: "POST use", call: () => chooseRoute(request(`${base}/${imageId}/use`, "POST"), imageParams) },
  { name: "GET file", call: () => fileRoute(request(`${base}/${imageId}/file`, "GET"), imageParams) },
];

function expectNothingTouched() {
  for (const [name, fn] of Object.entries(dependencies)) {
    if (name === "findActiveMembership" || name === "getCurrentSession") continue;
    expect(fn, name).not.toHaveBeenCalled();
  }
}

function signInAsConfigurer() {
  dependencies.getCurrentSession.mockResolvedValue({
    user: { id: "usr_admin", email: "admin@example.test", displayName: "Event Admin", globalRole: null },
  });
  dependencies.findActiveMembership.mockResolvedValue({
    eventId, userId: "usr_admin", role: "EVENT_ADMIN", status: "ACTIVE", permissions: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("image library route authorization", () => {
  it.each(routeCases)("rejects an unauthenticated caller on $name", async ({ call }) => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    const response = await call();
    expect(response.status).toBe(401);
    expectNothingTouched();
  });

  it.each(routeCases)("rejects staff without CONFIGURE_EVENT on $name", async ({ call }) => {
    dependencies.getCurrentSession.mockResolvedValue({
      user: { id: "usr_readonly", email: "readonly@example.test", displayName: "Read Only", globalRole: null },
    });
    dependencies.findActiveMembership.mockResolvedValue({
      eventId, userId: "usr_readonly", role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: [],
    });
    const response = await call();
    expect(response.status).toBe(403);
    expectNothingTouched();
  });

  it.each(routeCases)("rejects a caller with no membership for this event on $name", async ({ call }) => {
    dependencies.getCurrentSession.mockResolvedValue({
      user: { id: "usr_outsider", email: "outsider@example.test", displayName: "Outsider", globalRole: null },
    });
    dependencies.findActiveMembership.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(403);
    expectNothingTouched();
  });

  it.each(["POST upload", "PATCH image", "POST use"])("rejects a cross-origin write on %s before checking anything", async (name) => {
    signInAsConfigurer();
    const evil = { origin: "https://evil.example.test" };
    const calls: Record<string, () => Promise<Response>> = {
      "POST upload": () => uploadRoute(new Request(`${origin}${base}`, { method: "POST", headers: evil, body: new FormData() }), listParams),
      "PATCH image": () => patchRoute(new Request(`${origin}${base}/${imageId}`, { method: "PATCH", headers: { ...evil, "content-type": "application/json" }, body: "{}" }), imageParams),
      "POST use": () => chooseRoute(new Request(`${origin}${base}/${imageId}/use`, { method: "POST", headers: evil }), imageParams),
    };
    const response = await calls[name]();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expectNothingTouched();
  });
});

describe("image library routes for an event editor", () => {
  beforeEach(signInAsConfigurer);

  it("lists with the search, tag and year filters", async () => {
    dependencies.listLibraryImages.mockResolvedValue([]);
    dependencies.listLibraryTags.mockResolvedValue(["forest"]);
    const response = await listRoute(request(`${base}?q=camp&tag=forest&year=2026&includeRetired=true`, "GET"), listParams);
    expect(response.status).toBe(200);
    expect(dependencies.listLibraryImages).toHaveBeenCalledWith(eventId, expect.objectContaining({
      q: "camp", tag: "forest", year: 2026, includeRetired: true,
    }), expect.objectContaining({ configurableEventIds: expect.any(Function) }));
    expect(await response.json()).toEqual({ images: [], tags: ["forest"] });
  });

  it("maps upload refusals to a 400 or 413 with the code", async () => {
    dependencies.addUploadToLibrary.mockRejectedValue(new ImageLibraryError("IMAGE_TOO_LARGE", "Too big."));
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    const response = await uploadRoute(request(base, "POST", form, { "content-length": "200" }), listParams);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "IMAGE_TOO_LARGE" });
    const empty = await uploadRoute(request(base, "POST", new FormData(), { "content-length": "100" }), listParams);
    expect(empty.status).toBe(400);
  });

  it("refuses an upload declared over the size limit, or with no declared size, before reading the body", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    const tooLarge = request(base, "POST", form, { "content-length": String(26 * 1024 * 1024) });
    const readBody = vi.spyOn(tooLarge, "formData");
    const response = await uploadRoute(tooLarge, listParams);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "IMAGE_TOO_LARGE" });
    expect(readBody).not.toHaveBeenCalled();
    const unstated = await uploadRoute(request(base, "POST", form), listParams);
    expect(unstated.status).toBe(411);
    const notANumber = await uploadRoute(request(base, "POST", form, { "content-length": "lots" }), listParams);
    expect(notANumber.status).toBe(411);
    expect(dependencies.addUploadToLibrary).not.toHaveBeenCalled();
  });

  it("uses an image and returns the event's refreshed file list", async () => {
    dependencies.applyLibraryImageToEvent.mockResolvedValue({ assetId: "asset_9", reused: false });
    dependencies.listEventAssets.mockResolvedValue([{ id: "asset_9" }]);
    const response = await chooseRoute(request(`${base}/${imageId}/use`, "POST"), imageParams);
    expect(response.status).toBe(201);
    expect(dependencies.applyLibraryImageToEvent).toHaveBeenCalledWith(eventId, imageId, "usr_admin");
    expect(await response.json()).toMatchObject({ asset: { id: "asset_9" }, assets: [{ id: "asset_9" }] });
  });

  it("answers 409 when the image has been retired", async () => {
    dependencies.applyLibraryImageToEvent.mockRejectedValue(new ImageLibraryError("IMAGE_RETIRED", "Retired."));
    const response = await chooseRoute(request(`${base}/${imageId}/use`, "POST"), imageParams);
    expect(response.status).toBe(409);
  });

  it("retires and edits tags through PATCH", async () => {
    dependencies.getLibraryImageRecord.mockResolvedValue({ id: imageId });
    const response = await patchRoute(request(`${base}/${imageId}`, "PATCH", JSON.stringify({ tags: ["a"], retired: true }), { "content-type": "application/json" }), imageParams);
    expect(response.status).toBe(200);
    expect(dependencies.updateLibraryImageTags).toHaveBeenCalledWith(eventId, imageId, ["a"], "usr_admin");
    expect(dependencies.setLibraryImageRetired).toHaveBeenCalledWith(eventId, imageId, true, "usr_admin");
    const bad = await patchRoute(request(`${base}/${imageId}`, "PATCH", JSON.stringify({}), { "content-type": "application/json" }), imageParams);
    expect(bad.status).toBe(400);
  });

  it("serves the file through the shared response with its hardening headers", async () => {
    const file = { displayName: "a.png", contentType: "image/png", storageKey: "image-library/x.png" };
    dependencies.findLibraryImageFile.mockResolvedValue(file);
    dependencies.eventAssetResponse.mockResolvedValue(new Response("ok"));
    await fileRoute(request(`${base}/${imageId}/file?disposition=inline`, "GET"), imageParams);
    expect(dependencies.eventAssetResponse).toHaveBeenCalledWith(file, "inline");
    dependencies.findLibraryImageFile.mockResolvedValue(null);
    expect((await fileRoute(request(`${base}/${imageId}/file`, "GET"), imageParams)).status).toBe(404);
  });
});
