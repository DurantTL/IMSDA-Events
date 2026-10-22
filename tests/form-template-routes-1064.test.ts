import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  staffLoginRedirectPath: vi.fn(),
  listFormTemplateLibrary: vi.fn(),
  getFormTemplateForEditor: vi.fn(),
  saveFormTemplateVersion: vi.fn(),
  copyFormTemplate: vi.fn(),
}));

class Redirect extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Redirect(to); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
// The real system administrator gate runs; only the session behind it is faked.
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: mocks.staffLoginRedirectPath }));
vi.mock("@/modules/forms/form-template-library", () => ({
  listFormTemplateLibrary: mocks.listFormTemplateLibrary,
  getFormTemplateForEditor: mocks.getFormTemplateForEditor,
  saveFormTemplateVersion: mocks.saveFormTemplateVersion,
  copyFormTemplate: mocks.copyFormTemplate,
}));
vi.mock("@/modules/club-rosters/access", () => ({
  RosterAccessError: class RosterAccessError extends Error {
    constructor(public readonly code: string, public readonly status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/modules/club-rosters/api-errors", () => ({
  RosterBodyError: class RosterBodyError extends Error { readonly code = "INVALID_JSON_BODY"; },
  readRosterJson: async (request: Request) => request.json(),
}));
vi.mock("@/components/back-link", () => ({ BackLink: () => null }));

import { GET as LIST, POST as COPY } from "@/app/api/admin/form-templates/route";
import { GET as READ, PUT as SAVE } from "@/app/api/admin/form-templates/[templateKey]/route";
import AdminFormTemplatesPage from "@/app/(workspace)/admin/form-templates/page";
import FormTemplateEditorPage from "@/app/(workspace)/admin/form-templates/[templateKey]/page";
import { FormTemplateError } from "@/modules/forms/form-template-library-domain";
import { systemNavGroups } from "@/components/system-navigation";

/** The form template library routes and pages are for system administrators only (#1064). Synthetic data only. */

const admin = { id: "admin-1", globalRole: "SYSTEM_ADMIN" };
const eventAdmin = { id: "user-2", globalRole: "USER" };
const key = { params: Promise.resolve({ templateKey: "simple_rsvp" }) };
const saveBody = { expectedVersion: 1, name: "Synthetic", description: "", audience: "Individual", definition: { title: "Synthetic" } };
const json = (body: unknown, method = "POST") =>
  new Request("https://events.imsda.test/api/admin/form-templates", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const routes: Array<{ name: string; write: boolean; call: () => Promise<Response>; service: () => ReturnType<typeof vi.fn> }> = [
  { name: "list", write: false, call: () => LIST(new Request("https://events.imsda.test/api/admin/form-templates")), service: () => mocks.listFormTemplateLibrary },
  { name: "read one", write: false, call: () => READ(new Request("https://events.imsda.test/api/admin/form-templates/simple_rsvp"), key), service: () => mocks.getFormTemplateForEditor },
  { name: "save a version", write: true, call: () => SAVE(json(saveBody, "PUT"), key), service: () => mocks.saveFormTemplateVersion },
  { name: "copy", write: true, call: () => COPY(json({ sourceKey: "simple_rsvp", name: "Synthetic copy" })), service: () => mocks.copyFormTemplate },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.staffLoginRedirectPath.mockResolvedValue("/login");
  mocks.getCurrentSession.mockResolvedValue({ user: admin });
  mocks.listFormTemplateLibrary.mockResolvedValue([]);
  mocks.getFormTemplateForEditor.mockResolvedValue({ key: "simple_rsvp", version: 1 });
  mocks.saveFormTemplateVersion.mockResolvedValue({ key: "simple_rsvp", version: 2, versionId: "ver-2" });
  mocks.copyFormTemplate.mockResolvedValue({ key: "synthetic_copy", version: 1 });
});

describe("form template routes", () => {
  for (const route of routes) {
    it(`${route.name}: refuses a signed-in user who is not a system administrator, before doing anything`, async () => {
      mocks.getCurrentSession.mockResolvedValue({ user: eventAdmin });
      const response = await route.call();
      expect(response.status).toBe(403);
      expect((await response.json()).message).toContain("form templates");
      expect(route.service()).not.toHaveBeenCalled();
    });

    it(`${route.name}: refuses a visitor who is not signed in`, async () => {
      mocks.getCurrentSession.mockResolvedValue({ user: null });
      const response = await route.call();
      expect(response.status).toBe(401);
      expect(route.service()).not.toHaveBeenCalled();
    });

    if (route.write) {
      it(`${route.name}: refuses a cross-origin request first`, async () => {
        mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
        const response = await route.call();
        expect(response.status).toBe(403);
        expect(mocks.getCurrentSession).not.toHaveBeenCalled();
        expect(route.service()).not.toHaveBeenCalled();
      });
    }
  }

  it("lists and reads for a system administrator, with no caching", async () => {
    const list = await LIST(new Request("https://events.imsda.test/api/admin/form-templates"));
    expect(list.status).toBe(200);
    expect(list.headers.get("Cache-Control")).toContain("no-store");
    const read = await READ(new Request("https://events.imsda.test/api/admin/form-templates/simple_rsvp"), key);
    expect(await read.json()).toMatchObject({ template: { key: "simple_rsvp" } });
  });

  it("saves a version as the signed-in administrator, naming the version it started from", async () => {
    const response = await SAVE(json(saveBody, "PUT"), key);
    expect(response.status).toBe(200);
    expect(mocks.saveFormTemplateVersion).toHaveBeenCalledWith("simple_rsvp", saveBody, "admin-1");
  });

  it("copies as the signed-in administrator", async () => {
    const response = await COPY(json({ sourceKey: "simple_rsvp", name: "Synthetic copy" }));
    expect(response.status).toBe(201);
    expect(mocks.copyFormTemplate).toHaveBeenCalledWith({ sourceKey: "simple_rsvp", name: "Synthetic copy" }, "admin-1");
  });

  it("refuses a save with no expected version, or with an extra property, before saving", async () => {
    expect((await SAVE(json({ ...saveBody, expectedVersion: undefined }, "PUT"), key)).status).toBe(400);
    expect((await SAVE(json({ ...saveBody, key: "other" }, "PUT"), key)).status).toBe(400);
    expect(mocks.saveFormTemplateVersion).not.toHaveBeenCalled();
  });

  it("maps a stale save to 409, an unknown template to 404, an invalid definition to 400 and a busy lock to 503", async () => {
    const cases: Array<[FormTemplateError["code"], number]> = [["VERSION_CONFLICT", 409], ["TEMPLATE_NOT_FOUND", 404], ["INVALID_TEMPLATE", 400], ["TEMPLATE_BUSY", 503]];
    for (const [code, status] of cases) {
      mocks.saveFormTemplateVersion.mockRejectedValueOnce(new FormTemplateError(code, "Synthetic message."));
      const response = await SAVE(json(saveBody, "PUT"), key);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: code });
    }
  });

  it("answers 404 for a template that does not exist", async () => {
    mocks.getFormTemplateForEditor.mockResolvedValue(null);
    const response = await READ(new Request("https://events.imsda.test/api/admin/form-templates/nope"), { params: Promise.resolve({ templateKey: "nope" }) });
    expect(response.status).toBe(404);
  });
});

describe("form template pages", () => {
  it("send a visitor who is not signed in to sign in, and read nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(AdminFormTemplatesPage()).rejects.toMatchObject({ to: "/login" });
    await expect(FormTemplateEditorPage({ params: key.params })).rejects.toMatchObject({ to: "/login" });
    expect(mocks.listFormTemplateLibrary).not.toHaveBeenCalled();
    expect(mocks.getFormTemplateForEditor).not.toHaveBeenCalled();
  });

  it("refuse a signed-in user who is not a system administrator, and read nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: eventAdmin });
    await expect(AdminFormTemplatesPage()).rejects.toMatchObject({ to: "/no-access" });
    await expect(FormTemplateEditorPage({ params: key.params })).rejects.toMatchObject({ to: "/no-access" });
    expect(mocks.listFormTemplateLibrary).not.toHaveBeenCalled();
    expect(mocks.getFormTemplateForEditor).not.toHaveBeenCalled();
  });

  it("open for a system administrator, and answer not found for an unknown template", async () => {
    await expect(AdminFormTemplatesPage()).resolves.toBeTruthy();
    expect(mocks.listFormTemplateLibrary).toHaveBeenCalledTimes(1);
    mocks.getFormTemplateForEditor.mockResolvedValue(null);
    await expect(FormTemplateEditorPage({ params: key.params })).rejects.toThrow("NOT_FOUND");
  });

  it("are listed in the system administrator's navigation", () => {
    const hrefs = systemNavGroups.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain("/admin/form-templates");
  });
});
