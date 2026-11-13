import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; displayName: string; globalRole: string; accountStatus: string } },
  membership: null as null | { role: string; status: string; permissions: string[] },
  crossOrigin: false,
  restore: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => state.session ?? { user: null } }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: async () => state.membership }));
vi.mock("@/modules/access/request-security", () => ({
  rejectCrossOriginRequest: () => (state.crossOrigin ? Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }) : null),
}));
vi.mock("@/modules/events/page-versions", () => ({ listPageVersions: async () => [{ id: "v1", versionNumber: 1 }] }));
vi.mock("@/modules/events/page-restore", async () => {
  const actual = await vi.importActual<typeof import("@/modules/events/page-restore")>("@/modules/events/page-restore");
  return { ...actual, restoreEventPageVersion: state.restore };
});
vi.mock("@/modules/events/preview-link-repository", () => ({
  createPreviewLink: state.create,
  revokePreviewLink: state.revoke,
  getActivePreviewLink: async () => ({ expiresAt: "2027-03-24T15:00:00.000Z", createdAt: "2027-03-10T15:00:00.000Z" }),
}));

import { GET as listVersions } from "@/app/api/events/[eventId]/content/versions/route";
import { POST as restore } from "@/app/api/events/[eventId]/content/versions/[versionId]/restore/route";
import { DELETE as revokeLink, GET as linkStatus, POST as makeLink } from "@/app/api/events/[eventId]/content/preview-link/route";
import { PageVersionRestoreError } from "@/modules/events/page-restore";

const user = { user: { id: "user-1", email: "person@example.org", displayName: "Synthetic Person", globalRole: "USER", accountStatus: "ACTIVE" } };
const ctx = { params: Promise.resolve({ eventId: "event-1" }) };
const restoreCtx = { params: Promise.resolve({ eventId: "event-1", versionId: "v1" }) };
const req = (method: string) => new Request("https://events.imsda.test/x", { method, headers: { origin: "https://events.imsda.test" } });

beforeEach(() => {
  vi.clearAllMocks();
  state.session = user;
  state.membership = { role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] };
  state.crossOrigin = false;
  state.create.mockResolvedValue({ token: "synthetic-token", expiresAt: "2027-03-24T15:00:00.000Z" });
  state.revoke.mockResolvedValue(true);
  state.restore.mockResolvedValue({ sections: [], versionNumber: 1 });
});

describe("event page publishing routes (#1514)", () => {
  it("require CONFIGURE_EVENT and a signed-in person", async () => {
    state.membership = { role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: [] };
    for (const response of [
      await listVersions(req("GET"), ctx), await restore(req("POST"), restoreCtx), await linkStatus(req("GET"), ctx),
      await makeLink(req("POST"), ctx), await revokeLink(req("DELETE"), ctx),
    ]) expect(response.status).toBe(403);
    state.session = null;
    expect((await listVersions(req("GET"), ctx)).status).toBe(401);
    expect(state.restore).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("refuse cross-origin writes", async () => {
    state.crossOrigin = true;
    for (const response of [await restore(req("POST"), restoreCtx), await makeLink(req("POST"), ctx), await revokeLink(req("DELETE"), ctx)]) {
      expect(response.status).toBe(403);
    }
    expect(state.restore).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.revoke).not.toHaveBeenCalled();
  });

  it("lists versions for an event administrator", async () => {
    const response = await listVersions(req("GET"), ctx);
    expect(response.status).toBe(200);
    expect((await response.json()).versions).toHaveLength(1);
  });

  it("returns the preview link once on creation and never in the status read", async () => {
    const created = await makeLink(req("POST"), ctx);
    expect(created.status).toBe(201);
    expect((await created.json()).url).toContain("/event-preview/synthetic-token");
    expect(created.headers.get("cache-control")).toContain("no-store");
    const status = await (await linkStatus(req("GET"), ctx)).json();
    expect(status).toEqual({ active: true, expiresAt: "2027-03-24T15:00:00.000Z" });
  });

  it("answers a version that cannot come back with 409 and the plain sentence, and a missing one with 404", async () => {
    state.restore.mockRejectedValueOnce(new PageVersionRestoreError("VERSION_CANNOT_BE_RESTORED", "This version can no longer be restored."));
    const cannot = await restore(req("POST"), restoreCtx);
    expect(cannot.status).toBe(409);
    expect((await cannot.json()).message).toBe("This version can no longer be restored.");
    state.restore.mockRejectedValueOnce(new PageVersionRestoreError("VERSION_NOT_FOUND", "That version was not found for this event."));
    expect((await restore(req("POST"), restoreCtx)).status).toBe(404);
  });

  it("passes the system administrator flag to the restore", async () => {
    state.session = { user: { ...user.user, globalRole: "SYSTEM_ADMIN" } };
    await restore(req("POST"), restoreCtx);
    expect(state.restore).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1", versionId: "v1", isSystemAdmin: true }));
  });
});

describe("preview routes are private (#1514)", () => {
  it("sends the private headers for the preview page and its file route", async () => {
    const { default: nextConfig } = await import("../next.config");
    const rules = await nextConfig.headers!();
    for (const source of ["/event-preview/:path*", "/api/public/event-preview/:path*"]) {
      const headers = Object.fromEntries((rules.find((rule) => rule.source === source)?.headers ?? []).map((header) => [header.key, header.value]));
      expect(headers["Cache-Control"], source).toBe("private, no-store, max-age=0");
      expect(headers["Referrer-Policy"], source).toBe("no-referrer");
      expect(headers["X-Robots-Tag"], source).toContain("noindex");
    }
  });
});
