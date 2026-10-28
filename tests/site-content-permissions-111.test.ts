import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #111: who may edit the public hub. A system administrator and an active Site content editor may; a revoked editor,
 * plain staff and an Event Admin with CONFIGURE_EVENT may not, and neither may anyone signed out. Only a system
 * administrator grants or revokes the role. The real gates run; only the session, the grant lookup and the content
 * store are faked. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  grantFindFirst: vi.fn(),
  membershipFindMany: vi.fn(),
  getSiteContentAdminState: vi.fn(),
  saveHubDraft: vi.fn(),
  publishHubDraft: vi.fn(),
  restoreHubRevision: vi.fn(),
  discardHubDraft: vi.fn(),
  setSiteContentEditor: vi.fn(),
  originOk: { value: true },
}));

vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({
  rejectCrossOriginRequest: () => (mocks.originOk.value ? null : Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 })),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    siteContentEditorGrant: { findFirst: mocks.grantFindFirst },
    eventMembership: { findMany: mocks.membershipFindMany, findFirst: mocks.membershipFindMany },
  }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/site-content/hub-content", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSiteContentAdminState: mocks.getSiteContentAdminState,
  saveHubDraft: mocks.saveHubDraft,
  publishHubDraft: mocks.publishHubDraft,
  restoreHubRevision: mocks.restoreHubRevision,
  discardHubDraft: mocks.discardHubDraft,
}));
vi.mock("@/modules/access/site-content-editor", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setSiteContentEditor: mocks.setSiteContentEditor,
}));

import { GET as readState } from "@/app/api/admin/site-content/route";
import { DELETE as discardDraft, PUT as saveDraft } from "@/app/api/admin/site-content/draft/route";
import { POST as publish } from "@/app/api/admin/site-content/publish/route";
import { POST as restore } from "@/app/api/admin/site-content/restore/[revisionId]/route";
import { DELETE as revokeEditor, PUT as grantEditor } from "@/app/api/admin/users/[userId]/site-content-editor/route";
import { canManageSiteContent } from "@/modules/access/site-content-editor";

type Role = "systemAdmin" | "editor" | "revokedEditor" | "plainStaff" | "eventAdminConfigure";
const roles: Record<Role, { id: string; globalRole: "SYSTEM_ADMIN" | null }> = {
  systemAdmin: { id: "u-sys", globalRole: "SYSTEM_ADMIN" },
  editor: { id: "u-editor", globalRole: null },
  revokedEditor: { id: "u-revoked", globalRole: null },
  plainStaff: { id: "u-plain", globalRole: null },
  eventAdminConfigure: { id: "u-event", globalRole: null },
};

/** Signs in as a role. The grant lookup answers for the active grant only; a revoked one is simply not found, as in the query. */
function signInAs(role: Role | "anonymous") {
  if (role === "anonymous") {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    return;
  }
  const user = { ...roles[role], email: `${role}@imsda-events.test`, displayName: role };
  mocks.getCurrentSession.mockResolvedValue({ user });
  mocks.grantFindFirst.mockImplementation(async ({ where }: { where: { userId: string; revokedAt: null } }) => (
    role === "editor" && where.userId === user.id && where.revokedAt === null ? { id: "grant-1" } : null
  ));
  // An Event Admin who holds CONFIGURE_EVENT on an event: that must never open the hub.
  mocks.membershipFindMany.mockResolvedValue(role === "eventAdminConfigure" ? [{ role: "EVENT_ADMIN", permissions: ["CONFIGURE_EVENT"] }] : []);
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const request = (url: string, method: string, body?: unknown) => new Request(`https://events.imsda.test${url}`, {
  method,
  headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const calls: Array<{ name: string; call: () => Promise<Response>; effect: () => ReturnType<typeof vi.fn> }> = [
  { name: "reading the state", call: () => readState(request("/api/admin/site-content", "GET")), effect: () => mocks.getSiteContentAdminState },
  { name: "saving the draft", call: () => saveDraft(request("/api/admin/site-content/draft", "PUT", { content: {} })), effect: () => mocks.saveHubDraft },
  { name: "publishing", call: () => publish(request("/api/admin/site-content/publish", "POST")), effect: () => mocks.publishHubDraft },
  { name: "restoring", call: () => restore(request("/api/admin/site-content/restore/rev1", "POST"), ctx({ revisionId: "rev1" })), effect: () => mocks.restoreHubRevision },
  { name: "discarding the draft", call: () => discardDraft(request("/api/admin/site-content/draft", "DELETE")), effect: () => mocks.discardHubDraft },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.originOk.value = true;
  mocks.getSiteContentAdminState.mockResolvedValue({ content: {}, draft: null, published: null, draftDiffers: false, history: [] });
  mocks.saveHubDraft.mockResolvedValue({ id: "rev1" });
  mocks.publishHubDraft.mockResolvedValue({ id: "rev1" });
  mocks.restoreHubRevision.mockResolvedValue({ id: "rev2" });
  mocks.discardHubDraft.mockResolvedValue(undefined);
  mocks.setSiteContentEditor.mockResolvedValue({ changed: true });
});

describe("the hub content routes", () => {
  for (const { name, call, effect } of calls) {
    it(`${name}: signed-out gets 401, and plain staff, a revoked editor and an Event Admin with CONFIGURE_EVENT get 403`, async () => {
      signInAs("anonymous");
      expect((await call()).status).toBe(401);
      for (const role of ["plainStaff", "revokedEditor", "eventAdminConfigure"] as const) {
        signInAs(role);
        expect((await call()).status, role).toBe(403);
      }
      expect(effect()).not.toHaveBeenCalled();
    });

    it(`${name}: a system administrator and an active Site content editor are allowed`, async () => {
      for (const role of ["systemAdmin", "editor"] as const) {
        signInAs(role);
        const response = await call();
        expect(response.status, role).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
      }
      expect(effect()).toHaveBeenCalledTimes(2);
    });
  }

  it("refuses a cross-origin write before doing anything", async () => {
    signInAs("systemAdmin");
    mocks.originOk.value = false;
    for (const { call, name } of calls.slice(1)) expect((await call()).status, name).toBe(403);
    expect(mocks.saveHubDraft).not.toHaveBeenCalled();
    expect(mocks.publishHubDraft).not.toHaveBeenCalled();
  });

  it("passes the signed-in editor's id and the body to the store, and shows store errors as plain 4xx messages", async () => {
    signInAs("editor");
    await saveDraft(request("/api/admin/site-content/draft", "PUT", { content: { a: 1 }, note: "why" }));
    expect(mocks.saveHubDraft).toHaveBeenCalledWith({ a: 1 }, "why", "u-editor");
    const { SiteContentError } = await import("@/modules/site-content/hub-content");
    mocks.publishHubDraft.mockRejectedValue(new SiteContentError("NO_DRAFT", "There is no draft to publish. Save a draft first.", 409));
    const response = await publish(request("/api/admin/site-content/publish", "POST"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "NO_DRAFT", message: "There is no draft to publish. Save a draft first." });
  });
});

describe("canManageSiteContent", () => {
  it("is true for a system administrator and an active grant, false for everyone else", async () => {
    signInAs("editor");
    for (const [role, expected] of [["systemAdmin", true], ["editor", true], ["revokedEditor", false], ["plainStaff", false], ["eventAdminConfigure", false]] as const) {
      signInAs(role);
      const { user } = await mocks.getCurrentSession();
      expect(await canManageSiteContent(user), role).toBe(expected);
    }
    expect(await canManageSiteContent(null)).toBe(false);
  });

  it("reads the grant on every call, so a revoke applies on the next request", async () => {
    signInAs("editor");
    const { user } = await mocks.getCurrentSession();
    expect(await canManageSiteContent(user)).toBe(true);
    mocks.grantFindFirst.mockResolvedValue(null);
    expect(await canManageSiteContent(user)).toBe(false);
    expect(mocks.grantFindFirst).toHaveBeenCalledTimes(2);
  });

  it("never looks at event memberships", async () => {
    signInAs("eventAdminConfigure");
    const { user } = await mocks.getCurrentSession();
    expect(await canManageSiteContent(user)).toBe(false);
    expect(mocks.membershipFindMany).not.toHaveBeenCalled();
  });
});

describe("granting and revoking the role", () => {
  const grant = () => grantEditor(request("/api/admin/users/u-target/site-content-editor", "PUT"), ctx({ userId: "u-target" }));
  const revoke = () => revokeEditor(request("/api/admin/users/u-target/site-content-editor", "DELETE"), ctx({ userId: "u-target" }));

  it("only a system administrator can: an editor, plain staff and signed-out visitors cannot", async () => {
    signInAs("anonymous");
    expect((await grant()).status).toBe(401);
    for (const role of ["editor", "plainStaff", "eventAdminConfigure"] as const) {
      signInAs(role);
      expect((await grant()).status, role).toBe(403);
      expect((await revoke()).status, role).toBe(403);
    }
    expect(mocks.setSiteContentEditor).not.toHaveBeenCalled();
    signInAs("systemAdmin");
    expect((await grant()).status).toBe(200);
    expect(mocks.setSiteContentEditor).toHaveBeenLastCalledWith("u-target", true, "u-sys");
    expect((await revoke()).status).toBe(200);
    expect(mocks.setSiteContentEditor).toHaveBeenLastCalledWith("u-target", false, "u-sys");
  });

  it("refuses a cross-origin change", async () => {
    signInAs("systemAdmin");
    mocks.originOk.value = false;
    expect((await grant()).status).toBe(403);
    expect(mocks.setSiteContentEditor).not.toHaveBeenCalled();
  });
});

describe("the sidebar link for editors who are not system administrators", () => {
  it("is drawn only when the shell says the viewer is such an editor, and points at the editor page", async () => {
    const { readFileSync } = await import("node:fs");
    const shell = readFileSync("components/app-shell.tsx", "utf8");
    expect(shell).toContain("siteContentEditor && (");
    expect(shell).toContain('href="/admin/site-content"');
    const workspace = readFileSync("components/workspace-shell.tsx", "utf8");
    expect(workspace).toContain("const siteContentEditor = !isSystemAdmin && (await canManageSiteContent(user));");
  });
});
