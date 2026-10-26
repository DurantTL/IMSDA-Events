import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { formTemplateDefinitionSchema, type FormTemplate, type RegistrationFormDefinition } from "@/modules/forms/definition";
import { bundledSeededFormTemplates } from "@/modules/forms/seeded-template-data";
import { codeFormTemplate, codeFormTemplates, formTemplateSignature, type CodeFormTemplate, type FormTemplateSource } from "@/modules/forms/form-template-library-domain";

type Client = Prisma.TransactionClient | PrismaClient;

export type SeededFormTemplateSyncResult = {
  created: Array<{ key: string; version: number }>;
  updated: Array<{ key: string; from: number; to: number }>;
  unchanged: Array<{ key: string; version: number }>;
  /** Stored version is higher than the code's: left alone, reported (a rollback of the code, not of the data). */
  ahead: Array<{ key: string; stored: number; code: number | undefined }>;
  /** The latest version was saved in the app (#1064): left alone whatever the code says, reported. */
  appOwned: Array<{ key: string; version: number }>;
};

/** The one advisory lock sync and every app save take, so neither can overwrite the other's definition (#1064). */
export const formTemplateWriteLockKey = "seeded-form-template-sync";

/**
 * Brings every code-defined form template up to date, the way `lodging:sync`
 * and `club-forms:sync` do for theirs. The seeded ones (#153) carry a version in
 * their seed file and are written only when missing or at a higher version; the
 * rest of `formTemplates` carry none, so they are written when missing or when
 * their content changed, as the next version. Either way sync is safe to run on
 * every deploy and any number of times.
 *
 * A template whose latest version was saved in the app (`latestSource` APP,
 * #1064) is never touched, whatever version the code has: an administrator's
 * edit is not undone by a deploy. Each applied version also adds an immutable
 * `SeededFormTemplateVersion` row (source CODE). An advisory lock serializes
 * concurrent syncs and app saves. This never reads or writes an event, a
 * registration form, or a form version: forms copy a definition when they are
 * created, so a new version here reaches only forms created after it.
 */
export async function syncSeededFormTemplates(
  client: PrismaClient = getPrisma(),
  seeds: readonly CodeFormTemplate[] = codeFormTemplates(),
): Promise<SeededFormTemplateSyncResult> {
  const result: SeededFormTemplateSyncResult = { created: [], updated: [], unchanged: [], ahead: [], appOwned: [] };
  // Refuse a seed the form builder would refuse, before anything is written.
  const parsed = seeds.map((seed) => ({ seed, definition: formTemplateDefinitionSchema.parse(structuredClone(seed.definition)) }));
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${formTemplateWriteLockKey}))`;
    for (const { seed } of parsed) {
      const stored = await tx.seededFormTemplate.findUnique({
        where: { key: seed.key },
        select: { id: true, version: true, latestSource: true, name: true, description: true, audience: true, definition: true },
      });
      if (stored?.latestSource === "APP") {
        result.appOwned.push({ key: seed.key, version: stored.version });
        continue;
      }
      if (stored && seed.version !== undefined && stored.version > seed.version) {
        result.ahead.push({ key: seed.key, stored: stored.version, code: seed.version });
        continue;
      }
      if (stored && seed.version !== undefined && stored.version === seed.version) {
        result.unchanged.push({ key: seed.key, version: stored.version });
        continue;
      }
      // A template without a seed-file version is versioned by content: unchanged when it still reads the same.
      if (stored && seed.version === undefined && formTemplateSignature(stored) === formTemplateSignature(seed)) {
        result.unchanged.push({ key: seed.key, version: stored.version });
        continue;
      }
      const version = seed.version ?? (stored ? stored.version + 1 : 1);
      const data = {
        version,
        name: seed.name,
        description: seed.description,
        audience: seed.audience,
        definition: seed.definition as unknown as Prisma.InputJsonValue,
      };
      const row = stored
        ? await tx.seededFormTemplate.update({ where: { id: stored.id }, data: { ...data, latestSource: "CODE" } })
        : await tx.seededFormTemplate.create({ data: { key: seed.key, ...data, latestSource: "CODE" } });
      await tx.seededFormTemplateVersion.upsert({
        where: { templateId_version: { templateId: row.id, version } },
        create: { templateId: row.id, ...data, source: "CODE" },
        update: {},
      });
      if (stored) result.updated.push({ key: seed.key, from: stored.version, to: version });
      else result.created.push({ key: seed.key, version });
    }
  }, { timeout: 30_000 });
  return result;
}

/** A form template as the app should use it: its definition and, when it comes from a stored row or a seed file, the version. */
export type LoadedFormTemplate = FormTemplate & {
  version: number | undefined;
  source: FormTemplateSource;
  /**
   * The immutable `SeededFormTemplateVersion` id of the definition loaded (#1065); with the version row's template it is the
   * template-and-version pair a form records as its source. Null for the code's copy of a template that is not stored yet
   * (or whose stored row cannot be read): there is no stored version to point at, so nothing is recorded.
   */
  versionId: string | null;
};

/** The immutable version id of each stored row's latest version, in one read however many rows there are. Keyed by row id. */
async function storedVersionIds(client: Client, rows: ReadonlyArray<{ id: string; version: number }>) {
  if (rows.length === 0) return new Map<string, string>();
  const versions = await client.seededFormTemplateVersion.findMany({
    where: { OR: rows.map((row) => ({ templateId: row.id, version: row.version })) },
    select: { id: true, templateId: true, version: true },
  });
  return new Map(versions.map((version) => [version.templateId, version.id]));
}

/**
 * Any form template for a key, as the app should create new forms from it: the
 * stored row when there is one and it reads, otherwise the code's copy (a deploy
 * that has not run `form-templates:sync` yet still works). A template created in
 * the app (#1064) has no code copy, so an unreadable or missing row is simply
 * null: callers answer "not available" and nothing is guessed. One unreadable
 * stored row must not take down every caller, so this logs the key only, never
 * the stored definition.
 */
export async function loadFormTemplate(client: Client, key: string): Promise<LoadedFormTemplate | null> {
  const code = codeFormTemplate(key);
  const fromCode: LoadedFormTemplate | null = code
    ? { key: code.key, name: code.name, description: code.description, audience: code.audience, definition: code.definition, version: code.version, source: "CODE", versionId: null }
    : null;
  const row = await client.seededFormTemplate.findUnique({ where: { key } });
  if (!row) return fromCode;
  const definition = formTemplateDefinitionSchema.safeParse(row.definition);
  if (!definition.success) {
    logWarn(`Form template row failed validation; ${fromCode ? "using the code's copy" : "it is not available"}`, { templateKey: key, storedVersion: row.version });
    return fromCode;
  }
  return { key: row.key, name: row.name, description: row.description, audience: row.audience, definition: definition.data, version: row.version, source: row.latestSource, versionId: (await storedVersionIds(client, [row])).get(row.id) ?? null };
}

/**
 * Every form template staff can pick from: the code's templates in their order
 * (each as its stored row when that reads), then the templates created in the
 * app, by name. An app-created template whose stored definition no longer
 * validates is left out, with a log line naming its key.
 */
export async function loadAllFormTemplates(client: Client): Promise<LoadedFormTemplate[]> {
  const code = codeFormTemplates();
  const codeKeys = new Set(code.map((template) => template.key));
  // Two reads in all: every stored row, then every row's latest version id.
  const rows = await client.seededFormTemplate.findMany({ orderBy: [{ name: "asc" }, { key: "asc" }] });
  const versionIds = await storedVersionIds(client, rows);
  const loadedRow = (row: (typeof rows)[number], definition: RegistrationFormDefinition): LoadedFormTemplate => ({
    key: row.key, name: row.name, description: row.description, audience: row.audience, definition, version: row.version, source: row.latestSource, versionId: versionIds.get(row.id) ?? null,
  });
  const fromCode = code.flatMap((template): LoadedFormTemplate[] => {
    const row = rows.find((entry) => entry.key === template.key);
    const copy: LoadedFormTemplate = { key: template.key, name: template.name, description: template.description, audience: template.audience, definition: template.definition, version: template.version, source: "CODE", versionId: null };
    if (!row) return [copy];
    const definition = formTemplateDefinitionSchema.safeParse(row.definition);
    if (!definition.success) {
      logWarn("Form template row failed validation; using the code's copy", { templateKey: row.key, storedVersion: row.version });
      return [copy];
    }
    return [loadedRow(row, definition.data)];
  });
  const app = rows.filter((row) => !codeKeys.has(row.key)).flatMap((row): LoadedFormTemplate[] => {
    const definition = formTemplateDefinitionSchema.safeParse(row.definition);
    if (!definition.success) {
      logWarn("Form template row failed validation; it is left out of the picker", { templateKey: row.key, storedVersion: row.version });
      return [];
    }
    return [loadedRow(row, definition.data)];
  });
  return [...fromCode, ...app];
}

/**
 * The seeded template (#153) for a key: the synced row when there is one,
 * otherwise the bundled seed. Null for a key that is not a seeded template.
 * Kept for the three seeded templates; the app creates forms through
 * `loadFormTemplate`, which covers every template.
 */
export async function loadSeededFormTemplate(client: Client, key: string): Promise<(FormTemplate & { version: number }) | null> {
  if (!bundledSeededFormTemplates.some((seed) => seed.key === key)) return null;
  const loaded = await loadFormTemplate(client, key);
  if (!loaded || loaded.version === undefined) return null;
  return { ...loaded, version: loaded.version };
}
