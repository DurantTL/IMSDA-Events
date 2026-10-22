import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isLockTimeoutError } from "@/lib/prisma-errors";
import { assertNoReservedChoiceValues, registrationFormDefinitionSchema, type RegistrationFormDefinition } from "@/modules/forms/definition";
import { withExplicitSensitiveFlags } from "@/modules/forms/field-flags";
import {
  codeFormTemplate,
  codeFormTemplates,
  FormTemplateError,
  newFormTemplateKey,
  type CopyFormTemplateInput,
  type FormTemplateLibraryEntry,
  type FormTemplateSource,
  type FormTemplateVersionEntry,
  type SaveFormTemplateInput,
} from "@/modules/forms/form-template-library-domain";
import { formTemplateWriteLockKey, loadFormTemplate } from "@/modules/forms/seeded-templates";

/**
 * The form template library (#1064): what the system administrator's Form
 * templates page lists, opens, saves and copies. System administrators only:
 * every caller checks that before calling in (the pages and routes use
 * `requireSystemAdministrator`); nothing here reads or writes an event, a
 * registration form, a form version, an answer or a registration, and the audit
 * entries carry ids and the template key only.
 *
 * Every save adds a new immutable `SeededFormTemplateVersion` (source APP, with
 * the author) and moves the template row to it in one transaction, under the
 * same advisory lock `form-templates:sync` takes, so an app save and a sync, or
 * two app saves, can never overwrite each other. A save also names the version
 * the editor loaded and is refused when the template has moved on.
 */

const usageActions = ["REGISTRATION_FORM_CREATED", "REGISTRATION_FORM_DRAFT_FROM_TEMPLATE"];

async function writeTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await getPrisma().$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${formTemplateWriteLockKey}))`;
      await tx.$executeRaw`SET LOCAL lock_timeout = 0`;
      return operation(tx);
    }, { timeout: 10_000 });
  } catch (error) {
    if (isLockTimeoutError(error) || (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2028" || error.code === "P2034"))) {
      throw new FormTemplateError("TEMPLATE_BUSY", "Form templates are being changed right now. Wait a moment and try again.");
    }
    throw error;
  }
}

async function authorNames(userIds: readonly string[]) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map<string, string>();
  const users = await getPrisma().user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
  return new Map(users.map((user) => [user.id, user.displayName]));
}

/** How many forms were created from, or had their draft replaced from, a template. Counts distinct forms, read from the audit trail. */
async function usedByFormCount(key: string) {
  const rows = await getPrisma().auditLog.findMany({
    where: { action: { in: usageActions }, entityType: "RegistrationForm", metadata: { path: ["templateKey"], equals: key } },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  return rows.length;
}

/** Every template: the code's, in the picker's order, then the ones created in the app. Unreadable stored definitions are listed and flagged, never hidden. */
export async function listFormTemplateLibrary(): Promise<FormTemplateLibraryEntry[]> {
  const prisma = getPrisma();
  const code = codeFormTemplates();
  const rows = await prisma.seededFormTemplate.findMany({ orderBy: [{ name: "asc" }, { key: "asc" }] });
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const keys = [...code.map((template) => template.key), ...rows.filter((row) => !code.some((template) => template.key === row.key)).map((row) => row.key)];
  const latestAppVersions = await prisma.seededFormTemplateVersion.findMany({
    where: { source: "APP", templateId: { in: rows.map((row) => row.id) } },
    orderBy: { version: "desc" },
    select: { templateId: true, version: true, createdByUserId: true, createdAt: true },
  });
  const names = await authorNames(latestAppVersions.flatMap((version) => (version.createdByUserId ? [version.createdByUserId] : [])));
  const counts = await Promise.all(keys.map((key) => usedByFormCount(key)));
  return keys.map((key, index): FormTemplateLibraryEntry => {
    const row = rowByKey.get(key);
    const fromCode = code.find((template) => template.key === key);
    if (!row) {
      // Not synced yet: the code's copy is what the app uses.
      return { key, name: fromCode!.name, audience: fromCode!.audience, version: fromCode!.version ?? 1, source: "CODE", usedByForms: counts[index]!, unreadable: false, appCreated: false, updatedAt: null, updatedBy: null };
    }
    const readable = registrationFormDefinitionSchema.safeParse(row.definition).success;
    const latestApp = row.latestSource === "APP" ? latestAppVersions.find((version) => version.templateId === row.id && version.version === row.version) : undefined;
    return {
      key, name: row.name, audience: row.audience, version: readable ? row.version : null, source: row.latestSource, usedByForms: counts[index]!,
      unreadable: !readable, appCreated: !fromCode, updatedAt: row.updatedAt.toISOString(),
      updatedBy: latestApp?.createdByUserId ? names.get(latestApp.createdByUserId) ?? null : null,
    };
  });
}

export type FormTemplateEditorView = {
  key: string;
  name: string;
  description: string;
  audience: string;
  /** The version the editor is on and a save must name. */
  version: number;
  source: FormTemplateSource;
  appCreated: boolean;
  /** The definition to edit: the stored one, or the code's copy when the stored one cannot be read or the template is not stored yet. */
  definition: RegistrationFormDefinition;
  /** True when the stored definition could not be read and the editor starts from the code's copy; a save repairs it. */
  repairingUnreadable: boolean;
  usedByForms: number;
  versions: FormTemplateVersionEntry[];
};

/** The template as the editor opens it, or null for a key that is neither a code template nor stored. Throws TEMPLATE_UNREADABLE for an unreadable app-created template. */
export async function getFormTemplateForEditor(key: string): Promise<FormTemplateEditorView | null> {
  const prisma = getPrisma();
  const code = codeFormTemplate(key);
  const row = await prisma.seededFormTemplate.findUnique({ where: { key }, include: { versions: { orderBy: { version: "desc" }, select: { version: true, source: true, createdAt: true, createdByUserId: true } } } });
  if (!row && !code) return null;
  const usedByForms = await usedByFormCount(key);
  if (!row) {
    return {
      key, name: code!.name, description: code!.description, audience: code!.audience, version: code!.version ?? 1, source: "CODE", appCreated: false,
      definition: registrationFormDefinitionSchema.parse(structuredClone(code!.definition)), repairingUnreadable: false, usedByForms, versions: [],
    };
  }
  const names = await authorNames(row.versions.flatMap((version) => (version.createdByUserId ? [version.createdByUserId] : [])));
  const versions = row.versions.map((version): FormTemplateVersionEntry => ({
    version: version.version, source: version.source, createdAt: version.createdAt.toISOString(),
    createdBy: version.createdByUserId ? names.get(version.createdByUserId) ?? null : null,
  }));
  const stored = registrationFormDefinitionSchema.safeParse(row.definition);
  if (stored.success) {
    return { key, name: row.name, description: row.description, audience: row.audience, version: row.version, source: row.latestSource, appCreated: !code, definition: stored.data, repairingUnreadable: false, usedByForms, versions };
  }
  if (!code) throw new FormTemplateError("TEMPLATE_UNREADABLE", "This template's stored definition can no longer be read, so it cannot be opened.");
  return {
    key, name: code.name, description: code.description, audience: code.audience, version: row.version, source: row.latestSource, appCreated: false,
    definition: registrationFormDefinitionSchema.parse(structuredClone(code.definition)), repairingUnreadable: true, usedByForms, versions,
  };
}

/**
 * Saves a new immutable version of a template as the system administrator `actorUserId` and makes it the latest, marked as
 * coming from the app so `form-templates:sync` leaves it alone from then on. A code template that has not been synced yet
 * is stored at its code version first, in the same transaction. The previous versions are kept untouched.
 */
export async function saveFormTemplateVersion(key: string, input: SaveFormTemplateInput, actorUserId: string) {
  // Validate before any write, through the same definition schema forms use.
  const parsed = registrationFormDefinitionSchema.safeParse(input.definition);
  if (!parsed.success) throw new FormTemplateError("INVALID_TEMPLATE", parsed.error.issues[0]?.message ?? "The form definition is not valid.");
  const definition = withExplicitSensitiveFlags(parsed.data);
  try {
    assertNoReservedChoiceValues(definition);
  } catch (error) {
    throw new FormTemplateError("INVALID_TEMPLATE", error instanceof Error ? error.message : "The form definition is not valid.");
  }
  try {
    return await writeTransaction(async (tx) => {
      const code = codeFormTemplate(key);
      let row = await tx.seededFormTemplate.findUnique({ where: { key } });
      if (!row) {
        if (!code) throw new FormTemplateError("TEMPLATE_NOT_FOUND", "That form template was not found.");
        // Store the code's copy first so version 1 (or the seed's version) is kept as it was.
        row = await tx.seededFormTemplate.create({ data: {
          key, version: code.version ?? 1, name: code.name, description: code.description, audience: code.audience,
          definition: code.definition as unknown as Prisma.InputJsonValue, latestSource: "CODE",
        } });
        await tx.seededFormTemplateVersion.create({ data: {
          templateId: row.id, version: row.version, name: code.name, description: code.description, audience: code.audience,
          definition: code.definition as unknown as Prisma.InputJsonValue, source: "CODE",
        } });
      }
      if (row.version !== input.expectedVersion) {
        throw new FormTemplateError("VERSION_CONFLICT", "This template was changed in another session. Reload it before saving again.");
      }
      const version = row.version + 1;
      const data = { name: input.name, description: input.description, audience: input.audience, definition: definition as unknown as Prisma.InputJsonValue };
      const created = await tx.seededFormTemplateVersion.create({ data: { templateId: row.id, version, ...data, source: "APP", createdByUserId: actorUserId } });
      await tx.seededFormTemplate.update({ where: { id: row.id }, data: { ...data, version, latestSource: "APP" } });
      await tx.auditLog.create({ data: {
        actorUserId, action: "FORM_TEMPLATE_VERSION_SAVED", entityType: "FormTemplate", entityId: row.id, correlationId: randomUUID(),
        summary: "Saved a new version of a form template.",
        metadata: { templateKey: key, versionId: created.id, versionNumber: version, previousVersionNumber: row.version, source: "APP", productionWrite: false },
      } });
      return { key, version, versionId: created.id };
    });
  } catch (error) {
    // Two saves of the same version number collide on (templateId, version); the loser reloads.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new FormTemplateError("VERSION_CONFLICT", "This template was changed in another session. Reload it before saving again.");
    }
    throw error;
  }
}

/**
 * Creates a new template in the app as a copy of an existing one, at version 1 from the app. Nothing that exists changes:
 * not the source template, and no form or live form version made from it. The new key is stable, derived from the name once,
 * and never one the code or another template uses.
 */
export async function copyFormTemplate(input: CopyFormTemplateInput, actorUserId: string) {
  return writeTransaction(async (tx) => {
    const source = await loadFormTemplate(tx, input.sourceKey);
    if (!source) throw new FormTemplateError("TEMPLATE_NOT_FOUND", "That form template is not available to copy.");
    const taken = new Set([...codeFormTemplates().map((template) => template.key), ...(await tx.seededFormTemplate.findMany({ select: { key: true } })).map((row) => row.key)]);
    const key = newFormTemplateKey(input.name, taken);
    const data = { name: input.name, description: source.description, audience: source.audience, definition: source.definition as unknown as Prisma.InputJsonValue };
    const row = await tx.seededFormTemplate.create({ data: { key, version: 1, ...data, latestSource: "APP" } });
    const created = await tx.seededFormTemplateVersion.create({ data: { templateId: row.id, version: 1, ...data, source: "APP", createdByUserId: actorUserId } });
    await tx.auditLog.create({ data: {
      actorUserId, action: "FORM_TEMPLATE_CREATED", entityType: "FormTemplate", entityId: row.id, correlationId: randomUUID(),
      summary: "Created a form template as a copy of another.",
      metadata: { templateKey: key, copiedFromKey: input.sourceKey, versionId: created.id, versionNumber: 1, source: "APP", productionWrite: false },
    } });
    return { key, version: 1 };
  });
}
