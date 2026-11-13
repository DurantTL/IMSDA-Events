import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  saveOwnProfilePhoto: vi.fn(),
  removeOwnProfilePhoto: vi.fn(),
  removeProfilePhotoByStaff: vi.fn(),
  findProfilePhotoFile: vi.fn(),
  canViewProfilePhoto: vi.fn(),
  eventAssetResponse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/asset-response", () => ({ eventAssetResponse: dependencies.eventAssetResponse }));
vi.mock("@/modules/profile-photos/viewing", () => ({ canViewProfilePhoto: dependencies.canViewProfilePhoto }));
vi.mock("@/modules/profile-photos/repository", () => ({
  saveOwnProfilePhoto: dependencies.saveOwnProfilePhoto,
  removeOwnProfilePhoto: dependencies.removeOwnProfilePhoto,
  removeProfilePhotoByStaff: dependencies.removeProfilePhotoByStaff,
  findProfilePhotoFile: dependencies.findProfilePhotoFile,
}));

import { DELETE as deleteOwn, POST as uploadOwn } from "@/app/api/profile/photo/route";
import { DELETE as deleteByStaff, GET as getPhoto } from "@/app/api/profile-photos/[userId]/route";
import { ProfilePhotoError } from "@/modules/profile-photos/processing";

const origin = "https://events.imsda.test";
const userParams = (userId: string) => ({ params: Promise.resolve({ userId }) });
const signedIn = (globalRole: "SYSTEM_ADMIN" | null = null) =>
  dependencies.getCurrentSession.mockResolvedValue({ user: { id: "u1", email: "u1@example.test", displayName: "Staff One", globalRole } });

function uploadRequest(file: Blob | null, headers: Record<string, string> = {}) {
  const body = new FormData();
  if (file) body.append("file", file, "photo.jpg");
  return new Request(`${origin}/api/profile/photo`, { method: "POST", headers: { origin, "content-length": "1000", ...headers }, body });
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.eventAssetResponse.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" } }));
});

describe("own photo routes", () => {
  it("returns 401 when signed out", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await uploadOwn(uploadRequest(new Blob(["x"])))).status).toBe(401);
    expect((await deleteOwn(new Request(`${origin}/api/profile/photo`, { method: "DELETE", headers: { origin } }))).status).toBe(401);
    expect(dependencies.saveOwnProfilePhoto).not.toHaveBeenCalled();
    expect(dependencies.removeOwnProfilePhoto).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin write", async () => {
    signedIn();
    const response = await uploadOwn(new Request(`${origin}/api/profile/photo`, { method: "POST", headers: { origin: "https://evil.example.test" }, body: new FormData() }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(dependencies.saveOwnProfilePhoto).not.toHaveBeenCalled();
  });

  it("requires a declared length and refuses a large one before reading", async () => {
    signedIn();
    const noLength = new Request(`${origin}/api/profile/photo`, { method: "POST", headers: { origin }, body: new FormData() });
    expect((await uploadOwn(noLength)).status).toBe(411);
    expect((await uploadOwn(uploadRequest(new Blob(["x"]), { "content-length": String(6 * 1024 * 1024) }))).status).toBe(413);
    expect(dependencies.saveOwnProfilePhoto).not.toHaveBeenCalled();
  });

  it("asks for a file when none is sent", async () => {
    signedIn();
    expect((await uploadOwn(uploadRequest(null))).status).toBe(400);
  });

  it("saves the photo for the signed-in user only", async () => {
    signedIn();
    dependencies.saveOwnProfilePhoto.mockResolvedValue({ version: 1700000000000 });
    const response = await uploadOwn(uploadRequest(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" })));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ version: 1700000000000 });
    expect(dependencies.saveOwnProfilePhoto).toHaveBeenCalledWith("u1", expect.any(Uint8Array));
  });

  it("passes the plain unreadable message through", async () => {
    signedIn();
    dependencies.saveOwnProfilePhoto.mockRejectedValue(new ProfilePhotoError("UNREADABLE", "That photo could not be read. Please choose a JPG or PNG."));
    const response = await uploadOwn(uploadRequest(new Blob(["x"])));
    expect(response.status).toBe(422);
    expect((await response.json()).message).toBe("That photo could not be read. Please choose a JPG or PNG.");
  });

  it("removes the signed-in user's own photo", async () => {
    signedIn();
    const response = await deleteOwn(new Request(`${origin}/api/profile/photo`, { method: "DELETE", headers: { origin } }));
    expect(response.status).toBe(200);
    expect(dependencies.removeOwnProfilePhoto).toHaveBeenCalledWith("u1");
  });
});

describe("GET /api/profile-photos/[userId]", () => {
  const get = (query = "size=thumb") => getPhoto(new Request(`${origin}/api/profile-photos/u2?${query}`), userParams("u2"));

  it("returns 401 when signed out", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await get()).status).toBe(401);
    expect(dependencies.findProfilePhotoFile).not.toHaveBeenCalled();
  });

  it("returns 404 for a viewer who may not see the person, without looking the photo up", async () => {
    signedIn();
    dependencies.canViewProfilePhoto.mockResolvedValue(false);
    expect((await get()).status).toBe(404);
    expect(dependencies.findProfilePhotoFile).not.toHaveBeenCalled();
  });

  it("returns 404 when the person has no photo", async () => {
    signedIn();
    dependencies.canViewProfilePhoto.mockResolvedValue(true);
    dependencies.findProfilePhotoFile.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });

  it("serves the thumbnail privately as inline webp", async () => {
    signedIn();
    dependencies.canViewProfilePhoto.mockResolvedValue(true);
    dependencies.findProfilePhotoFile.mockResolvedValue("profile-photos/a.webp");
    const response = await get("size=thumb&v=1");
    expect(response.status).toBe(200);
    expect(dependencies.findProfilePhotoFile).toHaveBeenCalledWith("u2", "thumb");
    expect(dependencies.eventAssetResponse).toHaveBeenCalledWith(expect.objectContaining({ contentType: "image/webp", storageKey: "profile-photos/a.webp" }), "inline");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("defaults to the full size", async () => {
    signedIn();
    dependencies.canViewProfilePhoto.mockResolvedValue(true);
    dependencies.findProfilePhotoFile.mockResolvedValue("profile-photos/a.webp");
    await get("size=bogus");
    expect(dependencies.findProfilePhotoFile).toHaveBeenCalledWith("u2", "full");
  });
});

describe("DELETE /api/profile-photos/[userId]", () => {
  const remove = (headers: Record<string, string> = { origin }) =>
    deleteByStaff(new Request(`${origin}/api/profile-photos/u2`, { method: "DELETE", headers }), userParams("u2"));

  it("returns 403 to anyone who is not a system administrator", async () => {
    signedIn();
    expect((await remove()).status).toBe(403);
    expect(dependencies.removeProfilePhotoByStaff).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await remove()).status).toBe(401);
  });

  it("lets a system administrator remove it, recording who did", async () => {
    signedIn("SYSTEM_ADMIN");
    dependencies.removeProfilePhotoByStaff.mockResolvedValue(true);
    expect((await remove()).status).toBe(200);
    expect(dependencies.removeProfilePhotoByStaff).toHaveBeenCalledWith("u2", "u1");
  });

  it("returns 404 when there is no photo to remove", async () => {
    signedIn("SYSTEM_ADMIN");
    dependencies.removeProfilePhotoByStaff.mockResolvedValue(false);
    expect((await remove()).status).toBe(404);
  });
});
