import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  listActiveAttendeeTypes: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/attendee-types/repository", () => ({
  listActiveAttendeeTypes: dependencies.listActiveAttendeeTypes,
}));

import { canRestoreVersion, focusTargetId, restoreButtonId, restoreConfirmLabel, restoreConfirmation, restoreNotice, restoreSaveTarget, versionStateLabel, versionWhoWhen } from "@/components/registration-builder/version-history";
import { formTemplates, registrationFormDefinitionSchema, type RegistrationFormDefinition } from "@/modules/forms/definition";
import { updateRegistrationForm } from "@/modules/forms/repository";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

// Synthetic fixtures only.
const base = formTemplates[0]!.definition as RegistrationFormDefinition;
const oldDefinition = registrationFormDefinitionSchema.parse({ ...structuredClone(base), title: "Synthetic old wording" });
const currentDefinition = registrationFormDefinitionSchema.parse({ ...structuredClone(base), title: "Synthetic current wording" });
const t1 = new Date("2026-08-01T00:00:00.000Z");
const t2 = new Date("2026-09-01T00:00:00.000Z");
const t3 = new Date("2026-10-01T00:00:00.000Z");

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1", formId: "form-1", versionNumber: 1, status: "ARCHIVED", definition: oldDefinition,
    publishedAt: t1, createdAt: t1, updatedAt: t1, createdBy: { displayName: "Synthetic Staff" },
    testSubmissions: [], _count: { testSubmissions: 0 }, ...overrides,
  };
}
function formRow(versions: unknown[]) {
  return { id: "form-1", eventId: "event-1", name: "Synthetic form", slug: "synthetic-form", status: "PUBLISHED", createdAt: t1, updatedAt: t1, createdBy: { displayName: "Synthetic Staff" }, versions };
}
function txFor(versions: unknown[]) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    eventMealPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    registrationForm: { findFirst: vi.fn().mockResolvedValue(formRow(versions)), update: vi.fn().mockResolvedValue({}) },
    registrationFormVersion: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }), delete: vi.fn(), deleteMany: vi.fn() },
    formTestSubmission: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    registration: { update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}
function prismaFor(tx: ReturnType<typeof txFor>, after: unknown[]) {
  return {
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    registrationForm: { findFirst: vi.fn().mockResolvedValue(formRow(after)) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.listActiveAttendeeTypes.mockResolvedValue([]);
});

describe("History rows (#1140)", () => {
  const versions = [
    { versionNumber: 3, status: "DRAFT", publishedAt: null },
    { versionNumber: 2, status: "PUBLISHED", publishedAt: t2.toISOString() },
    { versionNumber: 1, status: "ARCHIVED", publishedAt: t1.toISOString() },
  ];
  const row = (index: number) => ({ ...versions[index]!, updatedAt: "", createdBy: "" });
  it("words the state: Live, Draft, Superseded, and Withdrawn when nothing newer went live", () => {
    expect(versionStateLabel(row(0), versions)).toBe("Draft");
    expect(versionStateLabel(row(1), versions)).toBe("Live");
    expect(versionStateLabel(row(2), versions)).toBe("Superseded");
    expect(versionStateLabel(row(2), [versions[2]!])).toBe("Withdrawn");
  });
  it("shows who and when, in text", () => {
    expect(versionWhoWhen({ status: "PUBLISHED", versionNumber: 2, publishedAt: t2.toISOString(), updatedAt: t2.toISOString(), createdBy: "Synthetic Staff" })).toBe("Published Sep 1, 2026, 12:00 AM UTC, last saved by Synthetic Staff");
    expect(versionWhoWhen({ status: "DRAFT", versionNumber: 3, publishedAt: null, updatedAt: t3.toISOString(), createdBy: "Synthetic Staff" })).toBe("Saved Oct 1, 2026, 12:00 AM UTC by Synthetic Staff");
  });
});

describe("Restore as draft rules (#1140)", () => {
  it("is offered for live, withdrawn and superseded versions, never the draft", () => {
    expect(canRestoreVersion({ status: "PUBLISHED" })).toBe(true);
    expect(canRestoreVersion({ status: "ARCHIVED" })).toBe(true);
    expect(canRestoreVersion({ status: "DRAFT" })).toBe(false);
  });
  it("compares the draft's updatedAt, or the newest version's when there is no draft", () => {
    const list = [{ status: "ARCHIVED", versionNumber: 1, updatedAt: "a" }, { status: "PUBLISHED", versionNumber: 2, updatedAt: "b" }];
    expect(restoreSaveTarget(list)).toMatchObject({ draft: null, expectedUpdatedAt: "b" });
    expect(restoreSaveTarget([...list, { status: "DRAFT", versionNumber: 3, updatedAt: "c" }])).toMatchObject({ expectedUpdatedAt: "c" });
  });
  it("asks only when it would replace a draft or discard edits", () => {
    expect(restoreConfirmation({ versionNumber: 1, draftVersionNumber: null, unsavedEdits: false })).toBeNull();
    expect(restoreConfirmation({ versionNumber: 1, draftVersionNumber: 3, unsavedEdits: false })?.lines.join(" ")).toContain("The current draft (version 3) will be replaced by a copy of version 1.");
    expect(restoreConfirmation({ versionNumber: 1, draftVersionNumber: null, unsavedEdits: true })?.lines.join(" ")).toContain("unsaved edits will be discarded");
  });
  it("words the confirm button for each of the three cases", () => {
    expect(restoreConfirmLabel({ versionNumber: 2, draftVersionNumber: 4, unsavedEdits: false })).toBe("Replace the draft with version 2");
    expect(restoreConfirmLabel({ versionNumber: 2, draftVersionNumber: null, unsavedEdits: true })).toBe("Discard edits and restore version 2");
    expect(restoreConfirmLabel({ versionNumber: 2, draftVersionNumber: 4, unsavedEdits: true })).toBe("Discard edits and replace the draft with version 2");
    const both = restoreConfirmation({ versionNumber: 2, draftVersionNumber: 4, unsavedEdits: true });
    expect(both?.confirmLabel).toBe("Discard edits and replace the draft with version 2");
    expect(both?.lines).toHaveLength(3);
  });
  it("maps a focus request to the element that receives focus", () => {
    expect(focusTargetId({ kind: "draft-chip" })).toBe("fb-version-chip-draft");
    expect(focusTargetId({ kind: "restore-button", versionId: "v1" })).toBe(restoreButtonId("v1"));
    expect(restoreButtonId("v1")).toBe("fb-restore-v1");
  });
  it("sets the focus flag on success and on failure, not with a timeout", () => {
    const actions = read("components/registration-builder/use-builder-actions.tsx");
    const restore = actions.slice(actions.indexOf("async function restoreVersion"), actions.indexOf("return { createFromTemplate"));
    expect(restore).toContain('setFocusRequest({ kind: "draft-chip" })');
    expect(restore).toContain('kind: "restore-button"');
    expect(restore).not.toContain("setTimeout");
    expect(read("components/registration-builder/builder-form-list.tsx")).toContain("id={restoreButtonId(version.id)}");
  });
  it("uses the notice wording from the issue", () => {
    expect(restoreNotice(2)).toBe("Version 2 copied into the draft. Publish to make it live.");
  });
});

describe("Restore goes through the existing draft save (#1140)", () => {
  it("with no draft: creates the next draft from the old definition and changes no existing version", async () => {
    const old = version();
    const live = version({ id: "version-2", versionNumber: 2, status: "PUBLISHED", definition: currentDefinition, publishedAt: t2, updatedAt: t2 });
    const tx = txFor([live, old]);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx, [version({ id: "version-3", versionNumber: 3, status: "DRAFT", publishedAt: null }), live, old]));

    const result = await updateRegistrationForm("event-1", "form-1", "user-1", { definition: oldDefinition, expectedUpdatedAt: t2.toISOString() });

    expect(tx.registrationFormVersion.create).toHaveBeenCalledTimes(1);
    expect(tx.registrationFormVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ versionNumber: 3, status: "DRAFT", formId: "form-1" }) });
    expect(tx.registrationFormVersion.update).not.toHaveBeenCalled();
    expect(tx.registrationFormVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.registrationFormVersion.delete).not.toHaveBeenCalled();
    expect(tx.registrationFormVersion.deleteMany).not.toHaveBeenCalled();
    expect(tx.registration.update).not.toHaveBeenCalled();
    expect(tx.registration.updateMany).not.toHaveBeenCalled();
    expect(result.versions.find((item) => item.versionNumber === 2)?.status).toBe("PUBLISHED");
    expect(result.versions.find((item) => item.versionNumber === 1)?.status).toBe("ARCHIVED");
  });

  it("with a saved draft: replaces only that draft's content, conditionally on its updatedAt", async () => {
    const draft = version({ id: "version-3", versionNumber: 3, status: "DRAFT", publishedAt: null, definition: currentDefinition, updatedAt: t3 });
    const live = version({ id: "version-2", versionNumber: 2, status: "PUBLISHED", definition: currentDefinition, publishedAt: t2, updatedAt: t2 });
    const tx = txFor([draft, live, version()]);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx, [draft, live, version()]));

    await updateRegistrationForm("event-1", "form-1", "user-1", { definition: oldDefinition, expectedUpdatedAt: t3.toISOString() });

    expect(tx.registrationFormVersion.create).not.toHaveBeenCalled();
    expect(tx.registrationFormVersion.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.registrationFormVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "version-3", status: "DRAFT", updatedAt: t3 } }));
    expect(tx.registrationFormVersion.update).not.toHaveBeenCalled();
    expect(tx.registration.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a stale restore with EDIT_CONFLICT and writes nothing", async () => {
    const draft = version({ id: "version-3", versionNumber: 3, status: "DRAFT", publishedAt: null, updatedAt: t3 });
    const tx = txFor([draft, version()]);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx, [draft]));

    await expect(updateRegistrationForm("event-1", "form-1", "user-1", { definition: oldDefinition, expectedUpdatedAt: t2.toISOString() })).rejects.toMatchObject({ code: "EDIT_CONFLICT" });
    expect(tx.registrationFormVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.registrationFormVersion.create).not.toHaveBeenCalled();
    expect(tx.formTestSubmission.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses an old definition that fails validation", async () => {
    const tx = txFor([version()]);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx, []));
    await expect(updateRegistrationForm("event-1", "form-1", "user-1", { definition: { ...oldDefinition, sections: [{ nope: true }] } as unknown as RegistrationFormDefinition, expectedUpdatedAt: t1.toISOString() })).rejects.toThrow();
    expect(tx.registrationFormVersion.create).not.toHaveBeenCalled();
  });
});

describe("Restore wiring (#1140)", () => {
  it("saves through the draft PATCH with expectedUpdatedAt, adding no route or permission", () => {
    const actions = read("components/registration-builder/use-builder-actions.tsx");
    const restore = actions.slice(actions.indexOf("async function restoreVersion"), actions.indexOf("return { createFromTemplate"));
    expect(restore).toContain('method: "PATCH"');
    expect(restore).toContain("expectedUpdatedAt");
    expect(restore).toContain("restoreNotice(version.versionNumber)");
        expect(read("app/api/events/[eventId]/forms/[formId]/route.ts")).toContain('"MANAGE_FORMS"');
    expect(read("modules/access/permissions.ts")).not.toMatch(/RESTORE/i);
  });
  it("shows Restore only in the History tab", () => {
    expect(read("components/registration-builder/builder-editor-shell.tsx")).toContain("<BuilderVersionHistory detailed />");
    expect(read("components/registration-builder/builder-form-list.tsx")).toContain("canRestoreVersion(version) &&");
  });
});
