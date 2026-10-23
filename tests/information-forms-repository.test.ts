import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const state = vi.hoisted(() => ({ prisma: {} as Record<string, unknown>, audit: vi.fn(), loadFormTemplate: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => state.prisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: state.audit }));
vi.mock("@/modules/forms/seeded-templates", () => ({ loadFormTemplate: state.loadFormTemplate }));

import { blankInformationFormDefinition, parseInformationFormDefinition } from "@/modules/information-forms/definition";
import { InformationFormError } from "@/modules/information-forms/errors";
import {
  createInformationForm,
  publishInformationForm,
  saveInformationFormDraft,
  setInformationFormStatus,
} from "@/modules/information-forms/repository";
import { MAX_EXPORT_ROWS, buildInformationFormResponsesCsv, getInformationFormResponse, labelAnswers, listInformationFormResponses, storeInformationFormResponse } from "@/modules/information-forms/responses";

const target = { scope: "EVENT", eventId: "event-1" } as const;
const t0 = new Date("2026-08-01T00:00:00.000Z");
const t1 = new Date("2026-08-02T00:00:00.000Z");

function survey(fields: Array<Record<string, unknown>>, title = "Post-event survey") {
  return parseInformationFormDefinition({
    title, description: "", confirmationMessage: "Thank you for answering.",
    sections: [{ id: "section_one", title: "Survey", description: "", fields: fields.map((field, index) => ({ id: `field_${index}`, helpText: "", scope: "REGISTRATION", required: false, options: [], ...field })) }],
  });
}

const rating = { key: "overall", label: "Overall rating", type: "SELECT", options: ["Good", "Poor"], required: true };
const parking = { key: "parking", label: "Parking was easy", type: "TEXT" };

function version(overrides: Record<string, unknown>) {
  return { id: "v1", formId: "form-1", versionNumber: 1, status: "DRAFT", definition: blankInformationFormDefinition("Post-event survey"), publishedAt: null, createdAt: t0, updatedAt: t0, ...overrides };
}

/** A prisma stand-in whose transaction client records every write. */
function install(versions: Array<ReturnType<typeof version>>, form: Record<string, unknown> = {}) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([{ id: "form-1" }]),
    informationForm: {
      findFirst: vi.fn().mockResolvedValue({ id: "form-1", name: "Post-event survey", status: "DRAFT", versions, ...form }),
      update: vi.fn().mockResolvedValue({}),
    },
    informationFormVersion: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  state.prisma = {
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    informationForm: { findFirst: vi.fn().mockResolvedValue({ id: "form-1", versions }) },
  };
  return tx;
}

beforeEach(() => vi.clearAllMocks());

describe("saving a draft (#1148)", () => {
  it("replaces the draft only while expectedUpdatedAt still matches", async () => {
    const tx = install([version({})]);
    await saveInformationFormDraft(target, "form-1", "user-1", { definition: survey([rating]), expectedUpdatedAt: t0.toISOString() });
    expect(tx.informationFormVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "v1", status: "DRAFT", updatedAt: t0 } }));
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it("refuses a stale save as an edit conflict and writes nothing", async () => {
    const tx = install([version({})]);
    await expect(saveInformationFormDraft(target, "form-1", "user-1", { definition: survey([rating]), expectedUpdatedAt: t1.toISOString() }))
      .rejects.toMatchObject({ code: "EDIT_CONFLICT", status: 409 });
    expect(tx.informationFormVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.informationFormVersion.create).not.toHaveBeenCalled();
  });

  it("treats a save that loses the race at the database as a conflict", async () => {
    const tx = install([version({})]);
    tx.informationFormVersion.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveInformationFormDraft(target, "form-1", "user-1", { definition: survey([rating]), expectedUpdatedAt: t0.toISOString() }))
      .rejects.toMatchObject({ code: "EDIT_CONFLICT" });
  });

  it("starts a new draft version, and never touches the published one, when the latest version is published", async () => {
    const tx = install([version({ status: "PUBLISHED", publishedAt: t0 })]);
    await saveInformationFormDraft(target, "form-1", "user-1", { definition: survey([rating, parking]), expectedUpdatedAt: t0.toISOString() });
    expect(tx.informationFormVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.informationFormVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ formId: "form-1", versionNumber: 2, status: "DRAFT" }) });
  });

  it("refuses a definition with a payment or health field before writing", async () => {
    const tx = install([version({})]);
    await expect(saveInformationFormDraft(target, "form-1", "user-1", { definition: { ...survey([rating]), payment: { enabled: false, paymentMethodFieldKey: "overall", cardOptionValue: "Good" } }, expectedUpdatedAt: t0.toISOString() }))
      .rejects.toThrow(/cannot take payment/);
    expect(tx.informationFormVersion.updateMany).not.toHaveBeenCalled();
  });

  it("reports a form id outside the target as not found", async () => {
    install([]);
    ((state.prisma.$transaction) as ReturnType<typeof vi.fn>).mockImplementation(async (operation: (client: unknown) => unknown) => operation({
      $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([]),
    }));
    await expect(saveInformationFormDraft(target, "other-scope-form", "user-1", { definition: survey([rating]), expectedUpdatedAt: t0.toISOString() }))
      .rejects.toMatchObject({ code: "FORM_NOT_FOUND", status: 404 });
  });
});

describe("publishing (#1148)", () => {
  it("promotes only the draft, supersedes the earlier published version, and never rewrites a published definition", async () => {
    const tx = install([
      version({ id: "v2", versionNumber: 2, updatedAt: t1, definition: survey([rating, parking]) }),
      version({ id: "v1", versionNumber: 1, status: "PUBLISHED", publishedAt: t0, definition: survey([rating]) }),
    ]);
    await publishInformationForm(target, "form-1", "user-1");
    const calls = tx.informationFormVersion.updateMany.mock.calls.map(([args]) => args);
    expect(calls[0]).toEqual({ where: { formId: "form-1", status: "PUBLISHED" }, data: { status: "SUPERSEDED" } });
    expect(calls[1].where).toEqual({ id: "v2", status: "DRAFT", updatedAt: t1 });
    expect(calls[1].data).toEqual({ status: "PUBLISHED", publishedAt: expect.any(Date) });
    // No call ever carries a definition: published versions are immutable.
    expect(calls.every((call) => !("definition" in call.data))).toBe(true);
  });

  it("refuses to publish a draft that changed since the editor loaded it", async () => {
    const tx = install([version({ definition: survey([rating]) })]);
    await expect(publishInformationForm(target, "form-1", "user-1", t1.toISOString())).rejects.toMatchObject({ code: "EDIT_CONFLICT", status: 409 });
    expect(tx.informationFormVersion.updateMany).not.toHaveBeenCalled();
    await publishInformationForm(target, "form-1", "user-1", t0.toISOString());
    expect(tx.informationFormVersion.updateMany).toHaveBeenCalled();
  });

  it("refuses to publish with no draft", async () => {
    install([version({ status: "PUBLISHED", publishedAt: t0 })]);
    await expect(publishInformationForm(target, "form-1", "user-1")).rejects.toMatchObject({ code: "NO_DRAFT" });
  });

  it("refuses to publish a stored draft that no longer passes the information-form check", async () => {
    const tx = install([version({ definition: { ...survey([rating]), payment: { enabled: false, paymentMethodFieldKey: "overall", cardOptionValue: "Good" } } })]);
    await expect(publishInformationForm(target, "form-1", "user-1")).rejects.toThrow(/cannot take payment/);
    expect(tx.informationFormVersion.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back a publish that lost a race with a save", async () => {
    const tx = install([version({ definition: survey([rating]) })]);
    tx.informationFormVersion.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    await expect(publishInformationForm(target, "form-1", "user-1")).rejects.toMatchObject({ code: "EDIT_CONFLICT" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("opens a form only once a version is published", async () => {
    install([version({})]);
    await expect(setInformationFormStatus(target, "form-1", "user-1", "OPEN")).rejects.toMatchObject({ code: "NOT_PUBLISHED" });
    const tx = install([version({ status: "PUBLISHED", publishedAt: t0 })]);
    await setInformationFormStatus(target, "form-1", "user-1", "OPEN");
    expect(tx.informationForm.update).toHaveBeenCalledWith({ where: { id: "form-1" }, data: { status: "OPEN" } });
    await setInformationFormStatus(target, "form-1", "user-1", "CLOSED");
    expect(tx.informationForm.update).toHaveBeenLastCalledWith({ where: { id: "form-1" }, data: { status: "CLOSED" } });
  });
});

function responseStore(overrides: { form?: Record<string, unknown>; existing?: { id: string } | null; createError?: unknown } = {}) {
  const create = overrides.createError ? vi.fn().mockRejectedValue(overrides.createError) : vi.fn().mockResolvedValue({ id: "response-new" });
  const findUnique = vi.fn().mockResolvedValue(overrides.existing ?? null);
  state.prisma = {
    informationForm: {
      findUnique: vi.fn().mockResolvedValue({
        id: "form-1", status: "OPEN", fillAccess: "ANYONE_WITH_LINK", opensAt: null, closesAt: null,
        versions: [{ id: "v1", versionNumber: 1, definition: survey([rating, { key: "notes", label: "Notes", type: "LONG_TEXT" }]) }],
        ...overrides.form,
      }),
    },
    informationFormResponse: { findUnique, create },
  };
  return { create, findUnique };
}

describe("storing responses (#1148)", () => {
  it("stores once and keeps only the version's own answers", async () => {
    const { create } = responseStore();
    const result = await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: { overall: "Good", notes: "Nice", stray: "ignored" } });
    expect(result).toEqual({ id: "response-new", created: true });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ versionId: "v1", answers: { overall: "Good", notes: "Nice" }, attendeeAccountId: null }) }));
  });

  it("returns the stored response for a repeated idempotency key without writing again", async () => {
    const { create } = responseStore({ existing: { id: "response-1" } });
    const result = await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: { overall: "Good" } });
    expect(result).toEqual({ id: "response-1", created: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns the winner when a concurrent retry stored it first", async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
    const { findUnique } = responseStore({ createError: duplicate });
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "response-winner" });
    const result = await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: { overall: "Good" } });
    expect(result).toEqual({ id: "response-winner", created: false });
  });

  it("refuses answers while closed, before opening, after closing, or when invalid", async () => {
    responseStore({ form: { status: "CLOSED" } });
    await expect(storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: { overall: "Good" } })).rejects.toMatchObject({ code: "FORM_NOT_OPEN" });
    responseStore({ form: { opensAt: new Date("2030-01-01T00:00:00.000Z") } });
    await expect(storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: { overall: "Good" } })).rejects.toMatchObject({ code: "FORM_NOT_OPEN" });
    responseStore({ form: { closesAt: new Date("2020-01-01T00:00:00.000Z") } });
    await expect(storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: { overall: "Good" } })).rejects.toMatchObject({ code: "FORM_NOT_OPEN" });
    const { create } = responseStore();
    await expect(storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: {} })).rejects.toMatchObject({ code: "ANSWERS_INVALID" });
    expect(create).not.toHaveBeenCalled();
  });

  it("needs a signed-in account for a SIGNED_IN form and records it", async () => {
    responseStore({ form: { fillAccess: "SIGNED_IN" } });
    await expect(storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: { overall: "Good" } })).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
    const { create } = responseStore({ form: { fillAccess: "SIGNED_IN" } });
    await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: { overall: "Good" }, attendeeAccountId: "account-1" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attendeeAccountId: "account-1" }) }));
  });
});

describe("reading responses (#1148)", () => {
  it("labels each answer from the version it was answered on, including fields since removed", () => {
    const oldVersion = survey([{ ...rating, label: "Overall rating (old wording)" }, parking]);
    expect(labelAnswers(oldVersion, { overall: "Good", parking: "Easy", unknown: "x", notes: "" })).toEqual([
      { key: "overall", label: "Overall rating (old wording)", type: "SELECT", value: "Good" },
      { key: "parking", label: "Parking was easy", type: "TEXT", value: "Easy" },
    ]);
  });

  it("exports a CSV with a column for every version, newest wording first, formula-safe", async () => {
    state.prisma = {
      informationForm: { findFirst: vi.fn().mockResolvedValue({ id: "form-1", name: "Post-event survey", slug: "post-event-survey" }) },
      informationFormVersion: {
        findMany: vi.fn().mockResolvedValue([
          { versionNumber: 2, definition: survey([{ ...rating, label: "Overall experience" }]) },
          { versionNumber: 1, definition: survey([rating, parking]) },
        ]),
      },
      informationFormResponse: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([
          { answers: { overall: "Good", parking: "=HYPERLINK(\"x\")" }, attendeeAccountId: null, submittedAt: t0, version: { versionNumber: 1 } },
          { answers: { overall: "Poor" }, attendeeAccountId: "account-1", submittedAt: t1, version: { versionNumber: 2 } },
        ]),
      },
    };
    const file = await buildInformationFormResponsesCsv(target, "form-1", "user-1");
    expect(file.filename).toBe("post-event-survey-responses.csv");
    // The export is audited with counts and ids only, never an answer.
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "INFORMATION_FORM_RESPONSES_EXPORTED", eventId: "event-1", actorUserId: "user-1", metadata: { formId: "form-1", scope: "EVENT", rowCount: 2, productionWrite: false },
    }));
    expect(JSON.stringify(state.audit.mock.calls)).not.toContain("HYPERLINK");
    const lines = file.csv.trim().split("\r\n");
    expect(lines[0]).toBe('"Submitted at","Form version","Signed in","Overall experience","Parking was easy"');
    expect(lines[1]).toContain('"Good"');
    expect(lines[1]).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(lines[2]).toBe(`"${t1.toISOString()}","2","Yes","Poor",""`);
  });

  it("refuses an export over the row limit instead of truncating", async () => {
    state.prisma = {
      informationForm: { findFirst: vi.fn().mockResolvedValue({ id: "form-1", name: "Survey", slug: "survey" }) },
      informationFormResponse: { count: vi.fn().mockResolvedValue(MAX_EXPORT_ROWS + 1), findMany: vi.fn() },
    };
    await expect(buildInformationFormResponsesCsv(target, "form-1", "user-1")).rejects.toMatchObject({ code: "EXPORT_TOO_LARGE", status: 413 });
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("still reads a response whose stored version no longer passes the refusal check", async () => {
    const storedBeforeRulesTightened = { ...survey([rating]), sections: [{ id: "section_one", title: "Medical history", description: "", fields: [{ id: "field_0", key: "list", label: "Please list", helpText: "", type: "LONG_TEXT", scope: "REGISTRATION", required: false, options: [] }] }] };
    expect(() => parseInformationFormDefinition(storedBeforeRulesTightened)).toThrow();
    const row = { id: "response-1", versionId: "v1", answers: { list: "Synthetic answer" }, attendeeAccountId: null, submittedAt: t0, version: { versionNumber: 1, definition: storedBeforeRulesTightened } };
    state.prisma = {
      informationForm: { findFirst: vi.fn().mockResolvedValue({ id: "form-1", name: "Survey", slug: "survey" }) },
      informationFormResponse: { findMany: vi.fn().mockResolvedValue([row]), findFirst: vi.fn().mockResolvedValue(row), count: vi.fn().mockResolvedValue(1) },
      informationFormVersion: { findMany: vi.fn().mockResolvedValue([{ versionNumber: 1, definition: storedBeforeRulesTightened }]) },
    };
    expect((await listInformationFormResponses(target, "form-1", { limit: 10 })).responses[0]!.answers).toEqual([{ key: "list", label: "Please list", type: "LONG_TEXT", value: "Synthetic answer" }]);
    expect((await getInformationFormResponse(target, "form-1", "response-1")).answers).toHaveLength(1);
    state.prisma = { ...state.prisma, informationFormResponse: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([{ answers: { list: "x" }, attendeeAccountId: null, submittedAt: t0, version: { versionNumber: 1 } }]) } };
    expect((await buildInformationFormResponsesCsv(target, "form-1", "user-1")).csv).toContain('"Please list"');
  });

  it("answers a form id from another scope, and a response id from another form, as not found", async () => {
    // The GENERAL form is not found when looked up through the event scope.
    const findForm = vi.fn().mockResolvedValue(null);
    state.prisma = { informationForm: { findFirst: findForm }, informationFormResponse: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn(), count: vi.fn() } };
    await expect(listInformationFormResponses(target, "general-form", { limit: 10 })).rejects.toMatchObject({ code: "FORM_NOT_FOUND", status: 404 });
    expect(findForm).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "general-form", scope: "EVENT", eventId: "event-1" } }));
    // A response belonging to another form is not found under this form.
    const findResponse = vi.fn().mockResolvedValue(null);
    state.prisma = { informationForm: { findFirst: vi.fn().mockResolvedValue({ id: "form-1", name: "Survey", slug: "survey" }) }, informationFormResponse: { findFirst: findResponse } };
    await expect(getInformationFormResponse(target, "form-1", "response-of-form-2")).rejects.toMatchObject({ code: "RESPONSE_NOT_FOUND", status: 404 });
    expect(findResponse).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "response-of-form-2", formId: "form-1" } }));
  });

  it("is an InformationFormError type the routes can map", () => {
    expect(new InformationFormError("FORM_NOT_FOUND", "x").status).toBe(404);
  });
});

describe("creating forms (#1148)", () => {
  function createClient(options: { collisions?: number } = {}) {
    let remaining = options.collisions ?? 0;
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
      void args;
      if (remaining > 0) {
        remaining -= 1;
        throw new Prisma.PrismaClientKnownRequestError("duplicate slug", { code: "P2002", clientVersion: "test" });
      }
      return { id: "form-new", name: "Post-event survey", versions: [] };
    });
    const tx = { informationForm: { create }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
    state.prisma = { $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)) };
    return { create, tx };
  }

  it("creates from a given definition, titled with the form name", async () => {
    const { create } = createClient();
    await createInformationForm(target, "user-1", { name: "Post-event survey", definition: survey([rating], "Ignored title") });
    const data = create.mock.calls[0]![0].data as { versions: { create: { definition: { title: string } } } };
    expect(data).toMatchObject({ scope: "EVENT", eventId: "event-1", scopeKey: "event-1", slug: "post-event-survey", sourceTemplateVersionId: null });
    expect(data.versions.create.definition.title).toBe("Post-event survey");
  });

  it("creates a GENERAL form with no event and the GENERAL scope key", async () => {
    const { create } = createClient();
    await createInformationForm({ scope: "GENERAL" }, "user-1", { name: "Interest survey" });
    expect(create.mock.calls[0]![0].data).toMatchObject({ scope: "GENERAL", eventId: null, scopeKey: "GENERAL" });
  });

  it("creates from a stored template and records its version", async () => {
    state.loadFormTemplate.mockResolvedValue({ definition: survey([rating]), versionId: "template-version-1" });
    const { create } = createClient();
    await createInformationForm(target, "user-1", { name: "Post-event survey", templateKey: "post_event" });
    expect(create.mock.calls[0]![0].data).toMatchObject({ sourceTemplateVersionId: "template-version-1" });
  });

  it("refuses a template that holds a health field, and creates nothing", async () => {
    state.loadFormTemplate.mockResolvedValue({ definition: { title: "Health template", description: "", confirmationMessage: "Thank you for answering.", sections: [{ id: "section_one", title: "Survey", description: "", fields: [{ id: "field_0", key: "current_medications", label: "Current medications", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] }] }] }, versionId: "template-version-2" });
    const { create } = createClient();
    await expect(createInformationForm(target, "user-1", { name: "Post-event survey", templateKey: "health_template" })).rejects.toThrow(/health, medical or other sensitive/);
    expect(create).not.toHaveBeenCalled();
  });

  it("reports an unknown template as not found", async () => {
    state.loadFormTemplate.mockResolvedValue(null);
    createClient();
    await expect(createInformationForm(target, "user-1", { name: "Post-event survey", templateKey: "nope" })).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND", status: 404 });
  });

  it("retries with the next web address when the slug is taken", async () => {
    const { create } = createClient({ collisions: 2 });
    await createInformationForm(target, "user-1", { name: "Post-event survey" });
    expect(create.mock.calls.map((call) => (call[0].data as { slug: string }).slug)).toEqual(["post-event-survey", "post-event-survey-2", "post-event-survey-3"]);
  });
});
