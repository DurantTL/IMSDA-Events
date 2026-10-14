import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { registrationFormDefinitionSchema, type FormTemplate } from "@/modules/forms/definition";
import { bundledSeededFormTemplates, type SeededFormTemplateSeed } from "@/modules/forms/seeded-template-data";

type Client = Prisma.TransactionClient | PrismaClient;

export type SeededFormTemplateSyncResult = {
  created: Array<{ key: string; version: number }>;
  updated: Array<{ key: string; from: number; to: number }>;
  unchanged: Array<{ key: string; version: number }>;
  /** Stored version is higher than the code's: left alone, reported (a rollback of the code, not of the data). */
  ahead: Array<{ key: string; stored: number; code: number }>;
};

const syncLockKey = "seeded-form-template-sync";

/**
 * Brings every seeded form template (#153) up to the version in the seed
 * files, the way `lodging:sync` and `club-forms:sync` do for theirs. A template
 * is written only when it is missing or its seed version is higher, so the
 * sync is safe to run on every deploy and any number of times; an advisory lock
 * serializes concurrent runs. Each applied version also adds an immutable
 * `SeededFormTemplateVersion` row. This never reads or writes an event, a
 * registration form, or a form version: forms copy a definition when they are
 * created, so a new version here reaches only forms created after it.
 */
export async function syncSeededFormTemplates(
  client: PrismaClient = getPrisma(),
  seeds: readonly SeededFormTemplateSeed[] = bundledSeededFormTemplates,
): Promise<SeededFormTemplateSyncResult> {
  const result: SeededFormTemplateSyncResult = { created: [], updated: [], unchanged: [], ahead: [] };
  // Refuse a seed the form builder would refuse, before anything is written.
  const parsed = seeds.map((seed) => ({ seed, definition: registrationFormDefinitionSchema.parse(structuredClone(seed.definition)) }));
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${syncLockKey}))`;
    for (const { seed } of parsed) {
      const stored = await tx.seededFormTemplate.findUnique({ where: { key: seed.key }, select: { id: true, version: true } });
      if (stored && stored.version > seed.version) {
        result.ahead.push({ key: seed.key, stored: stored.version, code: seed.version });
        continue;
      }
      if (stored && stored.version === seed.version) {
        result.unchanged.push({ key: seed.key, version: stored.version });
        continue;
      }
      const data = {
        version: seed.version,
        name: seed.name,
        description: seed.description,
        audience: seed.audience,
        definition: seed.definition as unknown as Prisma.InputJsonValue,
      };
      const row = stored
        ? await tx.seededFormTemplate.update({ where: { id: stored.id }, data })
        : await tx.seededFormTemplate.create({ data: { key: seed.key, ...data } });
      await tx.seededFormTemplateVersion.upsert({
        where: { templateId_version: { templateId: row.id, version: seed.version } },
        create: { templateId: row.id, ...data },
        update: {},
      });
      if (stored) result.updated.push({ key: seed.key, from: stored.version, to: seed.version });
      else result.created.push({ key: seed.key, version: seed.version });
    }
  });
  return result;
}

/**
 * The seeded template for a key as the app should create new forms from it:
 * the synced row when there is one, otherwise the bundled seed (a deploy that
 * has not run `form-templates:sync` yet still works, with the same version-1
 * content). Null for a key that is not a seeded template.
 */
export async function loadSeededFormTemplate(client: Client, key: string): Promise<(FormTemplate & { version: number }) | null> {
  const bundled = bundledSeededFormTemplates.find((seed) => seed.key === key);
  if (!bundled) return null;
  const row = await client.seededFormTemplate.findUnique({ where: { key } });
  if (!row) return { key: bundled.key, name: bundled.name, description: bundled.description, audience: bundled.audience, definition: bundled.definition, version: bundled.version };
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    audience: row.audience,
    definition: registrationFormDefinitionSchema.parse(row.definition),
    version: row.version,
  };
}
