import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  listActiveAttendeeTypes: vi.fn(),
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  saveFormAsTemplate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/attendee-types/repository", () => ({ listActiveAttendeeTypes: mocks.listActiveAttendeeTypes }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/club-rosters/api-errors", () => ({
  RosterBodyError: class RosterBodyError extends Error { readonly code = "INVALID_JSON_BODY"; },
  readRosterJson: async (request: Request) => request.json(),
}));
// The route is exercised with the real system administrator gate; only the library behind it is faked.
vi.mock("@/modules/forms/form-template-library", () => ({ saveFormAsTemplate: mocks.saveFormAsTemplate }));

import { POST as FROM_FORM } from "@/app/api/admin/form-templates/from-form/route";
import { POST as DISMISS } from "@/app/api/events/[eventId]/forms/[formId]/template-notice/route";
import { POST as CREATE } from "@/app/api/events/[eventId]/forms/route";
import { POST as DRAFT_FROM_TEMPLATE } from "@/app/api/events/[eventId]/forms/[formId]/draft-from-template/route";
import { formTemplates, registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { FormTemplateError } from "@/modules/forms/form-template-library-domain";
import { createRegistrationForm, dismissTemplateNotice, listRegistrationForms, replaceRegistrationFormDraftFromTemplate, getRegistrationForm } from "@/modules/forms/repository";

/** Source tracking and the "template changed" notice (#1065). Synthetic data only. */

const template = formTemplates[0]!;
const definition = registrationFormDefinitionSchema.parse({ ...structuredClone(template.definition), title: "Synthetic form" });
const at = new Date("2026-09-01T00:00:00.000Z");

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1", formId: "form-1", versionNumber: 1, status: "PUBLISHED", definition, publishedAt: at, createdAt: at, updatedAt: at,
    createdBy: { displayName: "Synthetic Staff" }, testSubmissions: [], _count: { testSubmissions: 0 }, ...overrides,
  };
}
function formRow(overrides: Record<string, unknown> = {}, versions: unknown[] = [version()]) {
  return {
    id: "form-1", eventId: "event-1", name: "Synthetic form", slug: "synthetic", status: "PUBLISHED", createdAt: at, updatedAt: at,
    createdBy: { displayName: "Synthetic Staff" }, sourceTemplateVersionId: null, dismissedTemplateVersionId: null, versions, ...overrides,
  };
}
/** A stored template row (readable) and the version rows the notice compares. */
const storedTemplate = { id: "tpl-1", key: template.key, name: "Synthetic template", description: "", audience: "Any", version: 3, definition: template.definition, latestSource: "APP" };

function txFor(options: { templateRow?: unknown; versionRow?: unknown; existingForm?: unknown } = {}) {
  const templateRow = "templateRow" in options ? options.templateRow : storedTemplate;
  const versionRow = "versionRow" in options ? options.versionRow : { id: "tpl-version-3" };
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    eventMealPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    seededFormTemplate: { findUnique: vi.fn().mockResolvedValue(templateRow) },
    seededFormTemplateVersion: {
      findUnique: vi.fn().mockResolvedValue(versionRow),
      findMany: vi.fn().mockResolvedValue(versionRow ? [{ ...(versionRow as object), templateId: "tpl-1", version: 3 }] : []),
    },
    registrationForm: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(options.existingForm ?? formRow()),
      create: vi.fn().mockResolvedValue({ id: "form-new", name: "Synthetic form" }),
      update: vi.fn().mockResolvedValue({}),
    },
    registrationFormVersion: { create: vi.fn().mockResolvedValue({ id: "version-new" }), update: vi.fn().mockResolvedValue({}) },
    formTestSubmission: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}
function prismaFor(tx: ReturnType<typeof txFor>, extra: Record<string, unknown> = {}) {
  return {
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    registrationForm: { findFirst: vi.fn().mockResolvedValue(formRow()), findMany: vi.fn().mockResolvedValue([]) },
    seededFormTemplateVersion: { findMany: vi.fn().mockResolvedValue([]) },
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listActiveAttendeeTypes.mockResolvedValue([]);
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
});

describe("recording the source on New from template and Update draft from a template", () => {
  it("records the immutable template version id on the new form, and in the audit entry", async () => {
    const tx = txFor();
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    await createRegistrationForm("event-1", "user-1", template.key);
    expect(tx.registrationForm.create.mock.calls[0]![0].data).toMatchObject({ sourceTemplateVersionId: "tpl-version-3" });
    expect(tx.auditLog.create.mock.calls[0]![0].data.metadata).toMatchObject({ templateKey: template.key, templateVersion: 3, templateVersionId: "tpl-version-3" });
  });

  it("records no source when the template is not stored yet (the code's copy), so the form stays silent", async () => {
    const tx = txFor({ templateRow: null });
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    await createRegistrationForm("event-1", "user-1", template.key);
    expect(tx.registrationForm.create.mock.calls[0]![0].data).not.toHaveProperty("sourceTemplateVersionId");
  });

  it("records the applied version with the draft replacement, in the same transaction, and clears an old dismissal", async () => {
    const tx = txFor();
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    await replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", template.key, "tpl-version-3");
    expect(tx.registrationForm.update).toHaveBeenCalledWith({ where: { id: "form-1" }, data: { status: "PUBLISHED", sourceTemplateVersionId: "tpl-version-3", dismissedTemplateVersionId: null } });
    expect(tx.registrationFormVersion.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0]![0].data.metadata).toMatchObject({ templateVersionId: "tpl-version-3" });
  });

  it("clears the form's source instead of leaving a stale one when the code's copy (no stored version) is applied", async () => {
    const tx = txFor({ templateRow: null });
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    await replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", template.key);
    expect(tx.registrationForm.update).toHaveBeenCalledWith({ where: { id: "form-1" }, data: { status: "PUBLISHED", sourceTemplateVersionId: null, dismissedTemplateVersionId: null } });
  });

  it("applies nothing and records nothing when the template moved on after it was chosen, never substituting the newer definition", async () => {
    const tx = txFor();
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    await expect(replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", template.key, "tpl-version-2")).rejects.toMatchObject({ code: "TEMPLATE_CHANGED" });
    expect(tx.registrationFormVersion.create).not.toHaveBeenCalled();
    expect(tx.registrationFormVersion.update).not.toHaveBeenCalled();
    expect(tx.registrationForm.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();

    const createTx = txFor();
    mocks.getPrisma.mockReturnValue(prismaFor(createTx));
    await expect(createRegistrationForm("event-1", "user-1", template.key, "tpl-version-2")).rejects.toMatchObject({ code: "TEMPLATE_CHANGED" });
    expect(createTx.registrationForm.create).not.toHaveBeenCalled();
  });

  it("leaves the earlier source untouched when the replacement fails", async () => {
    const tx = txFor();
    tx.registrationFormVersion.create.mockRejectedValue(new Error("synthetic failure"));
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    await expect(replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", template.key, "tpl-version-3")).rejects.toThrow("synthetic failure");
    expect(tx.registrationForm.update).not.toHaveBeenCalled();
  });

  it("passes the chosen template version from the create and draft routes to the repository's pin", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", globalRole: "SYSTEM_ADMIN" } });
    const tx = txFor();
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    const post = (body: unknown) => new Request("https://events.imsda.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const stale = await CREATE(post({ templateKey: template.key, templateVersionId: "tpl-version-2" }), { params: Promise.resolve({ eventId: "event-1" }) });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("TEMPLATE_CHANGED");
    const draft = await DRAFT_FROM_TEMPLATE(post({ templateKey: template.key, templateVersionId: "tpl-version-2" }), { params: Promise.resolve({ eventId: "event-1", formId: "form-1" }) });
    expect(draft.status).toBe(409);
  });
});

describe("the \"template changed\" notice", () => {
  const source = { id: "tpl-version-1", version: 1, template: { id: "tpl-1", key: template.key, name: "Synthetic template", version: 3, definition: template.definition } };
  function listWith(forms: unknown[], sources: unknown[] = [source]) {
    const prisma = prismaFor(txFor(), {
      registrationForm: { findMany: vi.fn().mockResolvedValue(forms), findFirst: vi.fn().mockResolvedValue(forms[0]) },
      seededFormTemplate: { findMany: vi.fn().mockResolvedValue([{ id: "tpl-1", definition: sources.length > 0 ? (sources[0] as { template: { definition: unknown } }).template.definition : null }]) },
      seededFormTemplateVersion: { findMany: vi.fn().mockResolvedValueOnce(sources).mockResolvedValueOnce([{ id: "tpl-version-3", templateId: "tpl-1" }]) },
    });
    mocks.getPrisma.mockReturnValue(prisma);
    return prisma;
  }

  it("shows nothing for a form with no source, without reading the template tables", async () => {
    const prisma = listWith([formRow()]);
    const [form] = await listRegistrationForms("event-1");
    expect(form!.templateNotice).toBeNull();
    expect(prisma.seededFormTemplateVersion.findMany).not.toHaveBeenCalled();
  });

  it("names the template and both versions when the template has a newer version", async () => {
    listWith([formRow({ sourceTemplateVersionId: "tpl-version-1" })]);
    const [form] = await listRegistrationForms("event-1");
    expect(form!.templateNotice).toEqual({ templateKey: template.key, templateName: "Synthetic template", appliedVersion: 1, latestVersion: 3, latestVersionId: "tpl-version-3" });
  });

  it("changes nothing by itself: reading a form with a notice writes nothing", async () => {
    const prisma = listWith([formRow({ sourceTemplateVersionId: "tpl-version-1" })]);
    await listRegistrationForms("event-1");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("is silent when the form is on the latest version", async () => {
    listWith([formRow({ sourceTemplateVersionId: "tpl-version-3" })], [{ ...source, id: "tpl-version-3", version: 3 }]);
    expect((await listRegistrationForms("event-1"))[0]!.templateNotice).toBeNull();
  });

  it("is silent once the advertised version was dismissed, and shows again for a later one", async () => {
    listWith([formRow({ sourceTemplateVersionId: "tpl-version-1", dismissedTemplateVersionId: "tpl-version-3" })]);
    expect((await listRegistrationForms("event-1"))[0]!.templateNotice).toBeNull();
    listWith([formRow({ sourceTemplateVersionId: "tpl-version-1", dismissedTemplateVersionId: "tpl-version-2" })]);
    expect((await listRegistrationForms("event-1"))[0]!.templateNotice).toMatchObject({ latestVersion: 3 });
  });

  it("is silent when the newest template definition cannot be read, because it could not be applied", async () => {
    listWith([formRow({ sourceTemplateVersionId: "tpl-version-1" })], [{ ...source, template: { ...source.template, definition: { sections: "synthetic" } } }]);
    expect((await listRegistrationForms("event-1"))[0]!.templateNotice).toBeNull();
  });

  it("reads and parses template definitions only for templates that are newer, once each", async () => {
    const prisma = listWith([formRow({ sourceTemplateVersionId: "tpl-version-1" }), formRow({ id: "form-2", sourceTemplateVersionId: "tpl-version-1" })]);
    await listRegistrationForms("event-1");
    const templateReads = (prisma as unknown as { seededFormTemplate: { findMany: ReturnType<typeof vi.fn> } }).seededFormTemplate.findMany;
    expect(templateReads).toHaveBeenCalledTimes(1);
    expect(templateReads.mock.calls[0]![0].where).toEqual({ id: { in: ["tpl-1"] } });
    const current = listWith([formRow({ sourceTemplateVersionId: "tpl-version-3" })], [{ ...source, id: "tpl-version-3", version: 3 }]);
    await listRegistrationForms("event-1");
    expect((current as unknown as { seededFormTemplate: { findMany: ReturnType<typeof vi.fn> } }).seededFormTemplate.findMany).not.toHaveBeenCalled();
  });

  it("is included when one form is read", async () => {
    listWith([formRow({ sourceTemplateVersionId: "tpl-version-1" })]);
    expect((await getRegistrationForm("event-1", "form-1"))!.templateNotice).toMatchObject({ latestVersionId: "tpl-version-3" });
  });
});

describe("dismissing the notice for one version", () => {
  function dismissTx(sourceVersion: { templateId: string; version: number } | null, target: { templateId: string; version: number } | null) {
    const tx = txFor({ existingForm: formRow({ sourceTemplateVersionId: "tpl-version-1" }) });
    tx.seededFormTemplateVersion.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const row = where.id === "tpl-version-1" ? sourceVersion : target;
      return row ? { ...row, template: { key: template.key } } : null;
    });
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    return tx;
  }

  it("records only the dismissed version, never touching the form's source, and audits ids", async () => {
    const tx = dismissTx({ templateId: "tpl-1", version: 1 }, { templateId: "tpl-1", version: 3 });
    await dismissTemplateNotice("event-1", "form-1", "user-1", "tpl-version-3");
    // Raw, so the form's updatedAt (which orders the forms list) is untouched, and only the dismissal column is written.
    expect(tx.registrationForm.update).not.toHaveBeenCalled();
    const [strings, ...values] = tx.$executeRaw.mock.calls.at(-1) as unknown as [string[], ...unknown[]];
    expect(strings.join("?")).toContain('SET "dismissedTemplateVersionId" =');
    expect(strings.join("?")).not.toContain("sourceTemplateVersionId");
    expect(values).toEqual(["tpl-version-3", "form-1"]);
    expect(tx.registrationFormVersion.create).not.toHaveBeenCalled();
    expect(tx.registrationFormVersion.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create.mock.calls[0]![0].data).toMatchObject({ action: "REGISTRATION_FORM_TEMPLATE_NOTICE_DISMISSED", eventId: "event-1", actorUserId: "user-1", entityId: "form-1" });
  });

  it("refuses a version that is not a newer version of this form's own template, and a form with no source", async () => {
    for (const [source, target] of [
      [{ templateId: "tpl-1", version: 3 }, { templateId: "tpl-1", version: 3 }],
      [{ templateId: "tpl-1", version: 1 }, { templateId: "tpl-other", version: 9 }],
      [{ templateId: "tpl-1", version: 1 }, null],
    ] as const) {
      const tx = dismissTx(source, target);
      await expect(dismissTemplateNotice("event-1", "form-1", "user-1", "tpl-version-9")).rejects.toMatchObject({ code: "TEMPLATE_CHANGED" });
      expect(tx.registrationForm.update).not.toHaveBeenCalled();
    }
    const noSource = txFor();
    mocks.getPrisma.mockReturnValue(prismaFor(noSource));
    await expect(dismissTemplateNotice("event-1", "form-1", "user-1", "tpl-version-3")).rejects.toMatchObject({ code: "TEMPLATE_CHANGED" });
    expect(noSource.registrationForm.update).not.toHaveBeenCalled();
  });

  it("reads another event's form as not found", async () => {
    const tx = txFor();
    tx.registrationForm.findFirst.mockResolvedValue(null);
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    await expect(dismissTemplateNotice("event-2", "form-1", "user-1", "tpl-version-3")).rejects.toMatchObject({ code: "FORM_NOT_FOUND" });
  });
});

describe("who can do what", () => {
  const saveBody = { mode: "NEW", eventId: "event-1", formId: "form-1", versionId: "version-1", name: "Synthetic", description: "", audience: "Any event" };
  const post = (body: unknown) => new Request("https://events.imsda.test/api/admin/form-templates/from-form", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("lets a system administrator save a form as a template", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    mocks.saveFormAsTemplate.mockResolvedValue({ key: "app_synthetic", version: 1, created: true, replacedAcknowledgments: [] });
    const response = await FROM_FORM(post(saveBody));
    expect(response.status).toBe(201);
    expect(mocks.saveFormAsTemplate).toHaveBeenCalledWith(expect.objectContaining({ mode: "NEW", formId: "form-1" }), "admin-1");
  });

  it("refuses everyone else on the server, including an event administrator, before the library runs", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-2", globalRole: "USER" } });
    const response = await FROM_FORM(post(saveBody));
    expect(response.status).toBe(403);
    expect(mocks.saveFormAsTemplate).not.toHaveBeenCalled();
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await FROM_FORM(post(saveBody))).status).toBeGreaterThanOrEqual(401);
    expect(mocks.saveFormAsTemplate).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin save before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    expect((await FROM_FORM(post(saveBody))).status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(mocks.saveFormAsTemplate).not.toHaveBeenCalled();
  });

  it("rejects a body that carries a definition, so only stored content is ever saved", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    const response = await FROM_FORM(post({ ...saveBody, definition: { title: "Unsaved editor content" } }));
    expect(response.status).toBe(400);
    expect(mocks.saveFormAsTemplate).not.toHaveBeenCalled();
  });

  it("maps a version conflict and a missing form to readable statuses", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    mocks.saveFormAsTemplate.mockRejectedValueOnce(new FormTemplateError("VERSION_CONFLICT", "changed"));
    expect((await FROM_FORM(post({ ...saveBody, mode: "NEW_VERSION", templateKey: "simple_rsvp", expectedVersion: 1, name: undefined, description: undefined, audience: undefined }))).status).toBe(409);
    mocks.saveFormAsTemplate.mockRejectedValueOnce(new FormTemplateError("FORM_NOT_FOUND", "missing"));
    expect((await FROM_FORM(post(saveBody))).status).toBe(404);
  });

  it("answers malformed JSON on the dismiss route with 400, not 500", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", globalRole: "SYSTEM_ADMIN" } });
    const request = new Request("https://events.imsda.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    const response = await DISMISS(request, { params: Promise.resolve({ eventId: "event-1", formId: "form-1" }) });
    expect(response.status).toBe(400);
  });

  it("lets staff with MANAGE_FORMS dismiss the notice, and nobody without it, with the cross-origin guard first", async () => {
    const tx = txFor({ existingForm: formRow({ sourceTemplateVersionId: "tpl-version-1" }) });
    tx.seededFormTemplateVersion.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ templateId: "tpl-1", version: where.id === "tpl-version-1" ? 1 : 3, template: { key: template.key } }));
    mocks.getPrisma.mockReturnValue(prismaFor(tx));
    const request = () => new Request("https://events.imsda.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ templateVersionId: "tpl-version-3" }) });
    const context = { params: Promise.resolve({ eventId: "event-1", formId: "form-1" }) };

    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", globalRole: "SYSTEM_ADMIN" } });
    expect((await DISMISS(request(), context)).status).toBe(200);

    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-3", globalRole: "USER" } });
    mocks.findActiveMembership.mockResolvedValue({ role: "VOLUNTEER", permissions: [] });
    tx.registrationForm.update.mockClear();
    expect((await DISMISS(request(), context)).status).toBe(403);
    expect(tx.registrationForm.update).not.toHaveBeenCalled();

    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    mocks.getCurrentSession.mockClear();
    expect((await DISMISS(request(), context)).status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });
});
