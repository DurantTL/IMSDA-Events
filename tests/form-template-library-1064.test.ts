/* eslint-disable @typescript-eslint/no-explicit-any -- the in-memory fake database receives loosely typed Prisma arguments */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));

import { getFormTemplate, registrationFormDefinitionSchema, type RegistrationFormDefinition } from "@/modules/forms/definition";
import {
  codeFormTemplates,
  FormTemplateError,
  formTemplateSignature,
  newFormTemplateKey,
  type CodeFormTemplate,
} from "@/modules/forms/form-template-library-domain";
import { copyFormTemplate, getFormTemplateForEditor, listFormTemplateLibrary, saveFormTemplateVersion } from "@/modules/forms/form-template-library";
import { loadAllFormTemplates, loadFormTemplate, loadSeededFormTemplate, syncSeededFormTemplates } from "@/modules/forms/seeded-templates";
import { bundledSeededFormTemplates } from "@/modules/forms/seeded-template-data";

/** Form templates and their versions (#1064). Synthetic data only; an in-memory stand-in for the database. */

type Row = Record<string, any>;

/**
 * A small in-memory database for the template tables. `$transaction` runs one
 * operation at a time, like the advisory lock sync and every app save take, so
 * the tests can race the operations and see what the lock guarantees.
 */
function fakeDatabase() {
  const templates: Row[] = [];
  const versions: Row[] = [];
  const audits: Row[] = [];
  const existingForms = new Set<string>(["form-1", "form-2", "form-3"]);
  const users: Row[] = [{ id: "admin-1", displayName: "Synthetic Admin" }];
  let sequence = 0;
  const duplicate = () => new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
  const copy = <T,>(value: T): T => structuredClone(value);
  const withVersions = (row: Row, include?: Row) => (include?.versions
    ? { ...copy(row), versions: versions.filter((version) => version.templateId === row.id).sort((a, b) => b.version - a.version).map(copy) }
    : copy(row));

  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    seededFormTemplate: {
      findUnique: vi.fn(async ({ where, include }: Row) => {
        const row = templates.find((entry) => entry.key === where.key);
        return row ? withVersions(row, include) : null;
      }),
      findMany: vi.fn(async ({ where }: Row = {}) => {
        const excluded: string[] = where?.key?.notIn ?? [];
        return templates.filter((entry) => !excluded.includes(entry.key)).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)).map(copy);
      }),
      create: vi.fn(async ({ data }: Row) => {
        if (templates.some((entry) => entry.key === data.key)) throw duplicate();
        const row = { id: `tpl-${++sequence}`, description: "", latestSource: "CODE", createdAt: new Date(), updatedAt: new Date(), ...copy(data) };
        templates.push(row);
        return copy(row);
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const row = templates.find((entry) => entry.id === where.id)!;
        Object.assign(row, copy(data), { updatedAt: new Date() });
        return copy(row);
      }),
    },
    seededFormTemplateVersion: {
      create: vi.fn(async ({ data }: Row) => {
        if (versions.some((entry) => entry.templateId === data.templateId && entry.version === data.version)) throw duplicate();
        const row = { id: `ver-${++sequence}`, description: "", source: "CODE", createdByUserId: null, createdAt: new Date(), ...copy(data) };
        versions.push(row);
        return copy(row);
      }),
      upsert: vi.fn(async ({ where, create }: Row) => {
        const key = where.templateId_version;
        const existing = versions.find((entry) => entry.templateId === key.templateId && entry.version === key.version);
        if (existing) return copy(existing);
        const row = { id: `ver-${++sequence}`, description: "", source: "CODE", createdByUserId: null, createdAt: new Date(), ...copy(create) };
        versions.push(row);
        return copy(row);
      }),
      findMany: vi.fn(async ({ where }: Row = {}) => versions.filter((entry) => (!where?.source || entry.source === where.source) && (!where?.templateId?.in || where.templateId.in.includes(entry.templateId))).sort((a, b) => b.version - a.version).map(copy)),
    },
    auditLog: {
      create: vi.fn(async ({ data }: Row) => { audits.push(copy(data)); return data; }),
    },
    // The grouped "forms created from it" read: audit rows joined to forms that still exist, counted by distinct form.
    $queryRaw: vi.fn(async () => {
      const counts = new Map<string, Set<string>>();
      for (const entry of audits) {
        if (entry.entityType !== "RegistrationForm" || !existingForms.has(entry.entityId) || !entry.metadata?.templateKey) continue;
        if (!["REGISTRATION_FORM_CREATED", "REGISTRATION_FORM_DRAFT_FROM_TEMPLATE"].includes(entry.action)) continue;
        counts.set(entry.metadata.templateKey, (counts.get(entry.metadata.templateKey) ?? new Set()).add(entry.entityId));
      }
      return [...counts].map(([key, forms]) => ({ key, count: forms.size }));
    }),
    user: { findMany: vi.fn(async ({ where }: Row) => users.filter((user) => where.id.in.includes(user.id)).map(copy)) },
  };
  let queue: Promise<unknown> = Promise.resolve();
  const prisma = {
    ...tx,
    $transaction: vi.fn((operation: (client: typeof tx) => Promise<unknown>) => {
      const run = queue.then(() => operation(tx));
      queue = run.catch(() => undefined);
      return run;
    }),
  };
  return { prisma, tx, templates, versions, audits, existingForms };
}

function titled(definition: RegistrationFormDefinition, title: string): RegistrationFormDefinition {
  const next = structuredClone(definition);
  next.title = title;
  return next;
}

const retreat = () => bundledSeededFormTemplates.find((seed) => seed.key === "womens_retreat_export")!;
const rsvp = () => getFormTemplate("simple_rsvp")!;
const save = (key: string, definition: RegistrationFormDefinition, expectedVersion: number, extra: { name?: string } = {}) =>
  saveFormTemplateVersion(key, { expectedVersion, name: extra.name ?? "Synthetic template", description: "Synthetic description", audience: "Individual", definition }, "admin-1");

let db: ReturnType<typeof fakeDatabase>;
beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDatabase();
  dependencies.getPrisma.mockReturnValue(db.prisma);
});

describe("syncing the code's templates (#1064)", () => {
  it("stores every template the code defines, the seeded ones at their seed-file version and the rest at version 1, all from the code", async () => {
    const result = await syncSeededFormTemplates(db.prisma as never);
    expect(result.created).toHaveLength(codeFormTemplates().length);
    expect(db.templates.map((row) => row.key)).toEqual(codeFormTemplates().map((template) => template.key));
    expect(db.templates.every((row) => row.latestSource === "CODE")).toBe(true);
    expect(db.templates.find((row) => row.key === "womens_retreat_export")!.version).toBe(retreat().version);
    expect(db.templates.find((row) => row.key === "simple_rsvp")!.version).toBe(1);
    expect(db.versions).toHaveLength(db.templates.length);
    expect(db.versions.every((row) => row.source === "CODE")).toBe(true);
  });

  it("is idempotent: a second run, and a run racing another, changes nothing", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const before = JSON.stringify([db.templates, db.versions]);
    const [again, racing] = await Promise.all([syncSeededFormTemplates(db.prisma as never), syncSeededFormTemplates(db.prisma as never)]);
    expect(again.created.length + again.updated.length).toBe(0);
    expect(racing.created.length + racing.updated.length).toBe(0);
    expect(again.unchanged).toHaveLength(codeFormTemplates().length);
    expect(JSON.stringify([db.templates, db.versions])).toBe(before);
  });

  it("racing first runs create each template once", async () => {
    await Promise.all([syncSeededFormTemplates(db.prisma as never), syncSeededFormTemplates(db.prisma as never)]);
    expect(db.templates).toHaveLength(codeFormTemplates().length);
    expect(db.versions).toHaveLength(codeFormTemplates().length);
  });

  it("brings a code template up to a higher seed version, as a new CODE version, and keeps the old one", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const revised: CodeFormTemplate = { ...retreat(), version: retreat().version + 1, definition: titled(retreat().definition, "Synthetic revised title") };
    const result = await syncSeededFormTemplates(db.prisma as never, [revised]);
    expect(result.updated).toEqual([{ key: "womens_retreat_export", from: retreat().version, to: retreat().version + 1 }]);
    const versions = db.versions.filter((row) => row.templateId === db.templates.find((entry) => entry.key === "womens_retreat_export")!.id);
    expect(versions.map((row) => row.version)).toEqual([retreat().version, retreat().version + 1]);
    expect(versions[0]!.definition.title).toBe(retreat().definition.title);
  });

  it("versions a template with no seed-file version by content, and not at all while the content is the same", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const changed: CodeFormTemplate = { ...rsvp(), version: undefined, definition: titled(rsvp().definition, "Synthetic changed RSVP") };
    const first = await syncSeededFormTemplates(db.prisma as never, [changed]);
    expect(first.updated).toEqual([{ key: "simple_rsvp", from: 1, to: 2 }]);
    const second = await syncSeededFormTemplates(db.prisma as never, [changed]);
    expect(second.unchanged).toEqual([{ key: "simple_rsvp", version: 2 }]);
  });

  it("reports a stored version that is ahead of the code and leaves it alone", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const older: CodeFormTemplate = { ...retreat(), version: 0 };
    const result = await syncSeededFormTemplates(db.prisma as never, [older]);
    expect(result.ahead).toEqual([{ key: "womens_retreat_export", stored: retreat().version, code: 0 }]);
  });

  it("refuses a template the builder would refuse, before writing anything", async () => {
    const broken = { ...rsvp(), version: undefined, definition: { ...rsvp().definition, sections: "nope" } } as unknown as CodeFormTemplate;
    await expect(syncSeededFormTemplates(db.prisma as never, [broken])).rejects.toThrow();
    expect(db.templates).toHaveLength(0);
  });

  it("never overwrites a template whose latest version was saved in the app, even for a much larger code version", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const edited = titled(retreat().definition, "Synthetic app edit");
    await save("womens_retreat_export", edited, retreat().version, { name: "Edited name" });
    const snapshot = JSON.stringify([db.templates, db.versions]);
    const bigger: CodeFormTemplate = { ...retreat(), version: retreat().version + 10, name: "Code name", definition: titled(retreat().definition, "Synthetic code revision") };
    const result = await syncSeededFormTemplates(db.prisma as never, [bigger]);
    expect(result.appOwned).toEqual([{ key: "womens_retreat_export", version: retreat().version + 1 }]);
    expect(result.updated).toEqual([]);
    expect(JSON.stringify([db.templates, db.versions])).toBe(snapshot);
    const row = db.templates.find((entry) => entry.key === "womens_retreat_export")!;
    expect(row.name).toBe("Edited name");
    expect(row.definition.title).toBe("Synthetic app edit");
    // Repeating it is still a no-op.
    await syncSeededFormTemplates(db.prisma as never, [bigger]);
    expect(JSON.stringify([db.templates, db.versions])).toBe(snapshot);
  });

  it("leaves an app-created template, which has no code copy, alone", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const copied = await copyFormTemplate({ sourceKey: "simple_rsvp", name: "Synthetic Copy" }, "admin-1");
    const snapshot = JSON.stringify([db.templates, db.versions]);
    await syncSeededFormTemplates(db.prisma as never);
    expect(JSON.stringify([db.templates, db.versions])).toBe(snapshot);
    expect(db.templates.some((row) => row.key === copied.key)).toBe(true);
  });
});

describe("saving a template version in the app (#1064)", () => {
  it("adds an immutable APP version with its author, moves the template to it, and keeps every earlier version", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const original = rsvp();
    const edited = titled(original.definition, "Synthetic first edit");
    const first = await save("simple_rsvp", edited, 1, { name: "RSVP, edited" });
    expect(first).toMatchObject({ key: "simple_rsvp", version: 2 });
    const row = db.templates.find((entry) => entry.key === "simple_rsvp")!;
    expect(row).toMatchObject({ version: 2, latestSource: "APP", name: "RSVP, edited" });
    const second = await save("simple_rsvp", titled(original.definition, "Synthetic second edit"), 2);
    expect(second.version).toBe(3);
    const stored = db.versions.filter((entry) => entry.templateId === row.id).sort((a, b) => a.version - b.version);
    expect(stored.map((entry) => [entry.version, entry.source, entry.createdByUserId])).toEqual([[1, "CODE", null], [2, "APP", "admin-1"], [3, "APP", "admin-1"]]);
    expect(stored[0]!.definition.title).toBe(original.definition.title);
    expect(stored[1]!.definition.title).toBe("Synthetic first edit");
    expect(stored[1]!.name).toBe("RSVP, edited");
  });

  it("stores a code template that was never synced at its code version first, so that version is kept", async () => {
    const result = await save("womens_retreat_export", titled(retreat().definition, "Synthetic edit"), retreat().version);
    expect(result.version).toBe(retreat().version + 1);
    const row = db.templates.find((entry) => entry.key === "womens_retreat_export")!;
    const stored = db.versions.filter((entry) => entry.templateId === row.id).sort((a, b) => a.version - b.version);
    expect(stored.map((entry) => entry.source)).toEqual(["CODE", "APP"]);
    expect(stored[0]!.definition.title).toBe(retreat().definition.title);
  });

  it("refuses a save made from a version the template has moved past, and writes nothing", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    await save("simple_rsvp", titled(rsvp().definition, "Synthetic edit"), 1);
    const before = JSON.stringify([db.templates, db.versions]);
    await expect(save("simple_rsvp", titled(rsvp().definition, "Synthetic stale edit"), 1)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(JSON.stringify([db.templates, db.versions])).toBe(before);
  });

  it("lets only one of two saves from the same version win, and loses no version", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const results = await Promise.allSettled([
      save("simple_rsvp", titled(rsvp().definition, "Synthetic edit A"), 1),
      save("simple_rsvp", titled(rsvp().definition, "Synthetic edit B"), 1),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const loser = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ code: "VERSION_CONFLICT" });
    const row = db.templates.find((entry) => entry.key === "simple_rsvp")!;
    expect(row.version).toBe(2);
    expect(db.versions.filter((entry) => entry.templateId === row.id).map((entry) => entry.version).sort()).toEqual([1, 2]);
    expect(row.definition.title).toBe("Synthetic edit A");
  });

  it("serializes a save and a sync: neither overwrites the other's definition, in either order", async () => {
    for (const order of ["save first", "sync first"] as const) {
      db = fakeDatabase();
      dependencies.getPrisma.mockReturnValue(db.prisma);
      await syncSeededFormTemplates(db.prisma as never);
      const bigger: CodeFormTemplate = { ...retreat(), version: retreat().version + 1, definition: titled(retreat().definition, "Synthetic code revision") };
      const doSave = () => save("womens_retreat_export", titled(retreat().definition, "Synthetic app edit"), retreat().version).then(() => "saved", (error: FormTemplateError) => error.code);
      const doSync = () => syncSeededFormTemplates(db.prisma as never, [bigger]);
      const [first, second] = order === "save first" ? await Promise.all([doSave(), doSync()]) : await Promise.all([doSync(), doSave()]);
      const row = db.templates.find((entry) => entry.key === "womens_retreat_export")!;
      const outcome = order === "save first" ? { saved: first, sync: second } : { sync: first, saved: second };
      if (order === "save first") {
        expect(outcome.saved).toBe("saved");
        expect((outcome.sync as Awaited<ReturnType<typeof doSync>>).appOwned).toHaveLength(1);
        expect(row.definition.title).toBe("Synthetic app edit");
        expect(row.latestSource).toBe("APP");
      } else {
        // The sync landed first, so the administrator's stale save is refused rather than written over it.
        expect(outcome.saved).toBe("VERSION_CONFLICT");
        expect(row.definition.title).toBe("Synthetic code revision");
        expect(row.latestSource).toBe("CODE");
      }
      const versions = db.versions.filter((entry) => entry.templateId === row.id).map((entry) => entry.version).sort();
      expect(new Set(versions).size).toBe(versions.length);
      expect(versions.at(-1)).toBe(row.version);
    }
  });

  it("validates through the definition schema before writing anything", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const before = JSON.stringify([db.templates, db.versions]);
    await expect(save("simple_rsvp", { title: 5 } as never, 1)).rejects.toMatchObject({ code: "INVALID_TEMPLATE" });
    expect(JSON.stringify([db.templates, db.versions])).toBe(before);
    expect(db.audits).toHaveLength(0);
  });

  it("refuses an acknowledgment that points at a policy version, because a template belongs to no event, and writes nothing", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const definition = structuredClone(rsvp().definition);
    definition.sections[0]!.fields.push({ id: "field_ack", key: "ack", label: "I agree", helpText: "", type: "ACKNOWLEDGMENT", scope: "REGISTRATION", required: true, options: [], acknowledgment: { source: "POLICY_VERSION", policyVersionId: "synthetic-version" } });
    const before = JSON.stringify([db.templates, db.versions]);
    await expect(save("simple_rsvp", definition, 1)).rejects.toMatchObject({ code: "INVALID_TEMPLATE", message: expect.stringContaining("policy version") });
    expect(JSON.stringify([db.templates, db.versions])).toBe(before);
    // Typed wording is fine.
    definition.sections[0]!.fields.at(-1)!.acknowledgment = { source: "TEXT", text: "I agree to the synthetic terms." };
    await expect(save("simple_rsvp", definition, 1)).resolves.toMatchObject({ version: 2 });
  });

  it("answers not found for a key that is neither a code template nor stored", async () => {
    await expect(save("no_such_template", rsvp().definition, 1)).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
    expect(db.templates).toHaveLength(0);
  });

  it("audits ids and the template key only: no template name, wording or definition", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    await save("simple_rsvp", titled(rsvp().definition, "Synthetic secret title"), 1, { name: "Synthetic secret name" });
    expect(db.audits).toHaveLength(1);
    const entry = db.audits[0]!;
    expect(entry).toMatchObject({ actorUserId: "admin-1", action: "FORM_TEMPLATE_VERSION_SAVED", entityType: "FormTemplate" });
    expect(entry.metadata).toMatchObject({ templateKey: "simple_rsvp", versionNumber: 2, previousVersionNumber: 1, source: "APP", productionWrite: false });
    expect(Object.keys(entry.metadata).sort()).toEqual(["previousVersionNumber", "productionWrite", "source", "templateKey", "versionId", "versionNumber"]);
    expect(JSON.stringify(entry)).not.toContain("Synthetic secret");
  });
});

describe("copying a template (#1064)", () => {
  it("creates a new app template at version 1 from the source's current definition, with a stable key, and changes nothing else", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    await save("simple_rsvp", titled(rsvp().definition, "Synthetic edited RSVP"), 1);
    const before = structuredClone(db.templates.filter((row) => row.key === "simple_rsvp"));
    const versionsBefore = db.versions.length;
    const created = await copyFormTemplate({ sourceKey: "simple_rsvp", name: "Spring Sign-Up!" }, "admin-1");
    expect(created).toEqual({ key: "app_spring_sign_up", version: 1 });
    const row = db.templates.find((entry) => entry.key === "app_spring_sign_up")!;
    expect(row).toMatchObject({ version: 1, latestSource: "APP", name: "Spring Sign-Up!" });
    expect(row.definition.title).toBe("Synthetic edited RSVP");
    expect(db.versions.length).toBe(versionsBefore + 1);
    expect(db.versions.find((entry) => entry.templateId === row.id)).toMatchObject({ source: "APP", createdByUserId: "admin-1", version: 1 });
    expect(db.templates.filter((entry) => entry.key === "simple_rsvp")).toEqual(before);
    expect(db.audits.at(-1)).toMatchObject({ action: "FORM_TEMPLATE_CREATED", metadata: { templateKey: "app_spring_sign_up", copiedFromKey: "simple_rsvp", versionNumber: 1 } });
  });

  it("never reuses a key the code or another template already has", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const first = await copyFormTemplate({ sourceKey: "simple_rsvp", name: "Simple RSVP" }, "admin-1");
    const second = await copyFormTemplate({ sourceKey: "simple_rsvp", name: "Simple RSVP" }, "admin-1");
    expect(first.key).toBe("app_simple_rsvp");
    expect(second.key).toBe("app_simple_rsvp_2");
    expect(newFormTemplateKey("***", new Set())).toBe("app_form_template");
    expect(newFormTemplateKey("x".repeat(200), new Set()).length).toBeLessThanOrEqual(60);
  });

  it("copies a code template that was never synced, and refuses an unknown source", async () => {
    const created = await copyFormTemplate({ sourceKey: "womens_retreat_export", name: "Synthetic Retreat Copy" }, "admin-1");
    expect(db.templates.find((row) => row.key === created.key)!.definition.title).toBe(retreat().definition.title);
    await expect(copyFormTemplate({ sourceKey: "no_such_template", name: "Whatever" }, "admin-1")).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
  });
});

describe("loading templates for event staff (#1064)", () => {
  it("uses the latest app version for new forms, with its version number", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    await save("simple_rsvp", titled(rsvp().definition, "Synthetic edited RSVP"), 1, { name: "Edited RSVP" });
    const loaded = await loadFormTemplate(db.tx as never, "simple_rsvp");
    expect(loaded).toMatchObject({ key: "simple_rsvp", name: "Edited RSVP", version: 2, source: "APP" });
    expect(loaded!.definition.title).toBe("Synthetic edited RSVP");
  });

  it("finds an app-created template, lists it after the code's, and loads it by key", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    const created = await copyFormTemplate({ sourceKey: "simple_rsvp", name: "Synthetic Copy" }, "admin-1");
    expect(await loadFormTemplate(db.tx as never, created.key)).toMatchObject({ key: created.key, version: 1, source: "APP" });
    const all = await loadAllFormTemplates(db.tx as never);
    expect(all.map((template) => template.key)).toEqual([...codeFormTemplates().map((template) => template.key), created.key]);
  });

  it("falls back to the code's copy for a code template and gives null for an unknown key", async () => {
    expect(await loadFormTemplate(db.tx as never, "simple_rsvp")).toMatchObject({ key: "simple_rsvp", version: undefined, source: "CODE" });
    expect(await loadFormTemplate(db.tx as never, "womens_retreat_export")).toMatchObject({ version: retreat().version });
    expect(await loadFormTemplate(db.tx as never, "no_such_template")).toBeNull();
  });

  it("handles a stored definition that no longer validates: the code's copy for a code template, nothing for an app-created one, logging the key only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await syncSeededFormTemplates(db.prisma as never);
    const created = await copyFormTemplate({ sourceKey: "simple_rsvp", name: "Synthetic Copy" }, "admin-1");
    for (const row of db.templates.filter((entry) => entry.key === "simple_rsvp" || entry.key === created.key)) row.definition = { sections: "synthetic-secret-marker" };
    expect(await loadFormTemplate(db.tx as never, "simple_rsvp")).toMatchObject({ key: "simple_rsvp", source: "CODE" });
    expect(await loadFormTemplate(db.tx as never, created.key)).toBeNull();
    const all = await loadAllFormTemplates(db.tx as never);
    expect(all.some((template) => template.key === created.key)).toBe(false);
    expect(all.some((template) => template.key === "simple_rsvp")).toBe(true);
    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.includes(created.key))).toBe(true);
    expect(lines.join("\n")).not.toContain("synthetic-secret-marker");
    warn.mockRestore();
  });

  it("still serves the seeded templates through the older loader", async () => {
    expect(await loadSeededFormTemplate(db.tx as never, "simple_rsvp")).toBeNull();
    expect(await loadSeededFormTemplate(db.tx as never, "womens_retreat_export")).toMatchObject({ version: retreat().version });
  });
});

describe("the library and the editor view (#1064)", () => {
  it("lists every template with its audience, version, source and how many forms were made from it", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    await save("simple_rsvp", titled(rsvp().definition, "Synthetic edit"), 1);
    const created = await copyFormTemplate({ sourceKey: "simple_rsvp", name: "Synthetic Copy" }, "admin-1");
    db.audits.push(
      { action: "REGISTRATION_FORM_CREATED", entityType: "RegistrationForm", entityId: "form-1", metadata: { templateKey: "simple_rsvp" } },
      { action: "REGISTRATION_FORM_DRAFT_FROM_TEMPLATE", entityType: "RegistrationForm", entityId: "form-1", metadata: { templateKey: "simple_rsvp" } },
      { action: "REGISTRATION_FORM_CREATED", entityType: "RegistrationForm", entityId: "form-2", metadata: { templateKey: "simple_rsvp" } },
      { action: "REGISTRATION_FORM_CREATED", entityType: "RegistrationForm", entityId: "form-3", metadata: { templateKey: created.key } },
      // A form that no longer exists is not counted.
      { action: "REGISTRATION_FORM_CREATED", entityType: "RegistrationForm", entityId: "form-deleted", metadata: { templateKey: "simple_rsvp" } },
    );
    const library = await listFormTemplateLibrary();
    expect(library.map((entry) => entry.key)).toEqual([...codeFormTemplates().map((template) => template.key), created.key]);
    expect(library.find((entry) => entry.key === "simple_rsvp")).toMatchObject({ version: 2, source: "APP", usedByForms: 2, appCreated: false, unreadable: false, updatedBy: "Synthetic Admin" });
    expect(library.find((entry) => entry.key === created.key)).toMatchObject({ version: 1, source: "APP", usedByForms: 1, appCreated: true });
    expect(library.find((entry) => entry.key === "womens_retreat_export")).toMatchObject({ source: "CODE", usedByForms: 0 });
  });

  it("lists a template that has not been synced from the code, and flags an unreadable one without hiding it", async () => {
    const library = await listFormTemplateLibrary();
    expect(library.find((entry) => entry.key === "simple_rsvp")).toMatchObject({ version: 1, source: "CODE", updatedAt: null });
    await syncSeededFormTemplates(db.prisma as never);
    db.templates.find((row) => row.key === "simple_rsvp")!.definition = { sections: 1 };
    expect((await listFormTemplateLibrary()).find((entry) => entry.key === "simple_rsvp")).toMatchObject({ version: null, unreadable: true });
  });

  it("opens a template with its definition and version history, and starts a repair from the code's copy when the stored one is unreadable", async () => {
    await syncSeededFormTemplates(db.prisma as never);
    await save("simple_rsvp", titled(rsvp().definition, "Synthetic edit"), 1);
    const view = await getFormTemplateForEditor("simple_rsvp");
    expect(view).toMatchObject({ key: "simple_rsvp", version: 2, source: "APP", repairingUnreadable: false });
    expect(view!.versions.map((entry) => [entry.version, entry.source, entry.createdBy])).toEqual([[2, "APP", "Synthetic Admin"], [1, "CODE", null]]);
    expect(registrationFormDefinitionSchema.safeParse(view!.definition).success).toBe(true);

    db.templates.find((row) => row.key === "simple_rsvp")!.definition = { sections: 1 };
    const repair = await getFormTemplateForEditor("simple_rsvp");
    expect(repair).toMatchObject({ version: 2, repairingUnreadable: true });
    expect(repair!.definition.title).toBe(rsvp().definition.title);
    // Saving from it stores a new, readable version on top of the broken one.
    await save("simple_rsvp", repair!.definition, 2);
    expect(registrationFormDefinitionSchema.safeParse(db.templates.find((row) => row.key === "simple_rsvp")!.definition).success).toBe(true);
  });

  it("opens an unsynced code template at its code version, refuses an unreadable app-created one, and returns null for an unknown key", async () => {
    expect(await getFormTemplateForEditor("womens_retreat_export")).toMatchObject({ version: retreat().version, source: "CODE", versions: [] });
    expect(await getFormTemplateForEditor("no_such_template")).toBeNull();
    const created = await copyFormTemplate({ sourceKey: "simple_rsvp", name: "Synthetic Copy" }, "admin-1");
    db.templates.find((row) => row.key === created.key)!.definition = { sections: 1 };
    await expect(getFormTemplateForEditor(created.key)).rejects.toMatchObject({ code: "TEMPLATE_UNREADABLE" });
  });

  it("compares template content, not key order or undefined properties", () => {
    const a = { name: "A", description: "", audience: "x", definition: { b: 1, a: undefined, c: [1, { z: 1, y: 2 }] } };
    const b = { name: "A", description: "", audience: "x", definition: { c: [1, { y: 2, z: 1 }], b: 1 } };
    expect(formTemplateSignature(a)).toBe(formTemplateSignature(b));
    expect(formTemplateSignature({ ...b, name: "B" })).not.toBe(formTemplateSignature(a));
  });
});
