import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  listActiveAttendeeTypes: vi.fn(),
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/attendee-types/repository", () => ({ listActiveAttendeeTypes: dependencies.listActiveAttendeeTypes }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: dependencies.findActiveMembership }));

import { POST } from "@/app/api/events/[eventId]/forms/[formId]/draft-from-template/route";
import { formTemplates, registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { replaceRegistrationFormDraftFromTemplate } from "@/modules/forms/repository";

// Synthetic fixtures only.
const template = formTemplates[0]!;
const oldDefinition = registrationFormDefinitionSchema.parse({ ...structuredClone(template.definition), title: "Old synthetic form" });
const updatedAt = new Date("2026-09-01T00:00:00.000Z");

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1", formId: "form-1", versionNumber: 1, status: "PUBLISHED", definition: oldDefinition,
    publishedAt: updatedAt, createdAt: updatedAt, updatedAt, createdBy: { displayName: "Synthetic Staff" },
    testSubmissions: [], _count: { testSubmissions: 0 }, ...overrides,
  };
}
function formRow(versions: unknown[]) {
  return { id: "form-1", eventId: "event-1", name: "Old synthetic form", slug: "old-synthetic", status: "PUBLISHED", createdAt: updatedAt, updatedAt, createdBy: { displayName: "Synthetic Staff" }, versions };
}
function txFor(versions: unknown[]) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    eventMealPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    seededFormTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    registrationForm: { findFirst: vi.fn().mockResolvedValue(formRow(versions)), update: vi.fn().mockResolvedValue({}) },
    registrationFormVersion: { create: vi.fn().mockResolvedValue({ id: "version-new" }), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    formTestSubmission: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}
function prismaFor(tx: ReturnType<typeof txFor>, after: unknown[] = []) {
  return {
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    registrationForm: { findFirst: vi.fn().mockResolvedValue(formRow(after)) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.listActiveAttendeeTypes.mockResolvedValue([]);
});

describe("updating a form's draft from a template (#1056)", () => {
  it("creates the next draft beside the published version and never touches the published row", async () => {
    const published = version();
    const tx = txFor([published]);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx, [version({ id: "version-new", versionNumber: 2, status: "DRAFT", publishedAt: null, definition: template.definition }), published]));

    const result = await replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", template.key);

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.registrationForm.findFirst.mock.invocationCallOrder[0]!);
    expect(tx.registrationFormVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ formId: "form-1", versionNumber: 2, status: "DRAFT" }) });
    const stored = tx.registrationFormVersion.create.mock.calls[0]![0].data.definition;
    expect(stored).toEqual(registrationFormDefinitionSchema.parse(structuredClone(template.definition)));
    expect(tx.registrationFormVersion.update).not.toHaveBeenCalled();
    expect(tx.registrationFormVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.formTestSubmission.deleteMany).not.toHaveBeenCalled();
    // The form stays PUBLISHED, and its name and slug are untouched.
    expect(tx.registrationForm.update).toHaveBeenCalledWith({ where: { id: "form-1" }, data: { status: "PUBLISHED", sourceTemplateVersionId: null, dismissedTemplateVersionId: null } });
    expect(result.versions.find((item) => item.versionNumber === 1)?.status).toBe("PUBLISHED");
    expect(result.activeVersion.versionNumber).toBe(2);
  });

  it("replaces an existing draft in place and deletes the tests that proved the old draft", async () => {
    const draft = version({ id: "version-2", versionNumber: 2, status: "DRAFT", publishedAt: null });
    const tx = txFor([draft, version()]);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx, [draft, version()]));

    await replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", template.key);

    expect(tx.registrationFormVersion.update).toHaveBeenCalledWith({ where: { id: "version-2" }, data: expect.objectContaining({ createdByUserId: "user-1" }) });
    expect(tx.registrationFormVersion.create).not.toHaveBeenCalled();
    expect(tx.formTestSubmission.deleteMany).toHaveBeenCalledWith({ where: { formVersionId: "version-2" } });
    expect(tx.auditLog.create.mock.calls[0]![0].data.metadata).toMatchObject({ replacedExistingDraft: true, invalidatedTestCount: 2 });
  });

  it("audits the form, template key and actor with ids only", async () => {
    const tx = txFor([version()]);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx, [version()]));

    await replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", template.key);

    const data = tx.auditLog.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ eventId: "event-1", actorUserId: "user-1", action: "REGISTRATION_FORM_DRAFT_FROM_TEMPLATE", entityId: "form-1" });
    expect(data.metadata).toMatchObject({ templateKey: template.key, versionNumber: 2 });
    expect(JSON.stringify(data.metadata)).not.toContain("sections");
  });

  it("falls back to a DRAFT form status when no version is live", async () => {
    const tx = txFor([version({ status: "ARCHIVED" })]);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx, []));
    await replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", template.key);
    expect(tx.registrationForm.update).toHaveBeenCalledWith({ where: { id: "form-1" }, data: { status: "DRAFT", sourceTemplateVersionId: null, dismissedTemplateVersionId: null } });
  });

  it("refuses an unknown template and writes nothing", async () => {
    const tx = txFor([version()]);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx));
    await expect(replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", "no-such-template")).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
    expect(tx.registrationFormVersion.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("reads another event's form as not found", async () => {
    const tx = txFor([]);
    tx.registrationForm.findFirst.mockResolvedValue(null);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx));
    await expect(replaceRegistrationFormDraftFromTemplate("event-2", "form-1", "user-1", template.key)).rejects.toMatchObject({ code: "FORM_NOT_FOUND" });
  });

  it("maps a concurrent draft creation to EDIT_CONFLICT and a lock timeout to FORM_BUSY", async () => {
    const tx = txFor([version()]);
    tx.registrationFormVersion.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
    dependencies.getPrisma.mockReturnValue(prismaFor(tx));
    await expect(replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", template.key)).rejects.toMatchObject({ code: "EDIT_CONFLICT" });

    const busy = txFor([version()]);
    busy.$queryRaw.mockRejectedValue(Object.assign(new Error("lock timeout 55P03"), { code: "55P03" }));
    dependencies.getPrisma.mockReturnValue(prismaFor(busy));
    await expect(replaceRegistrationFormDraftFromTemplate("event-1", "form-1", "user-1", template.key)).rejects.toMatchObject({ code: "FORM_BUSY" });
  });
});

describe("POST /api/events/[eventId]/forms/[formId]/draft-from-template (#1056)", () => {
  const origin = "https://events.imsda.test";
  const context = { params: Promise.resolve({ eventId: "event-1", formId: "form-1" }) };
  const staff = { id: "usr_staff", email: "staff@example.test", displayName: "Synthetic Staff", globalRole: null };
  function request(headers: Record<string, string> = { origin }, body: unknown = { templateKey: template.key }) {
    return new Request(`${origin}/api/events/event-1/forms/form-1/draft-from-template`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    dependencies.getCurrentSession.mockResolvedValue({ user: staff });
  });

  it("refuses a cross-origin request before any permission or write", async () => {
    const response = await POST(request({ origin: "https://evil.example.test" }), context);
    expect(response.status).toBe(403);
    expect(dependencies.getPrisma).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await POST(request(), context)).status).toBe(401);
    expect(dependencies.getPrisma).not.toHaveBeenCalled();
  });

  it("refuses a member without MANAGE_FORMS", async () => {
    dependencies.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: staff.id, role: "CHECK_IN_STAFF", status: "ACTIVE", permissions: [] });
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect(dependencies.getPrisma).not.toHaveBeenCalled();
  });

  it("lets a forms manager replace the draft", async () => {
    dependencies.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: staff.id, role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: [] });
    const tx = txFor([version()]);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx, [version()]));
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(tx.registrationFormVersion.create).toHaveBeenCalled();
  });
});
