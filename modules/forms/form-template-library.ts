import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isLockTimeoutError } from "@/lib/prisma-errors";
import { assertNoReservedChoiceValues, registrationFormDefinitionSchema, type RegistrationFormDefinition } from "@/modules/forms/definition";
import { withExplicitSensitiveFlags } from "@/modules/forms/field-flags";
import {
  assertTemplateHasNoPolicyVersions,
  codeFormTemplate,
  codeFormTemplates,
  FormTemplateError,
  newFormTemplateKey,
  replacePolicyVersionAcknowledgments,
  type CopyFormTemplateInput,
  type FormTemplateLibraryEntry,
  type FormTemplateSource,
  type FormTemplateVersionEntry,
  type SaveFormAsTemplateInput,
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

/**
 * How many forms still in the app were created from, or had their draft replaced from, each template: one grouped
 * read of the audit trail, joined to RegistrationForm so a deleted form is not counted. Keyed by template key. With a
 * `key` only that template is counted, so opening one template does not group the whole trail (#1065).
 */
async function usedByFormCounts(key?: string) {
  const rows = await getPrisma().$queryRaw<Array<{ key: string; count: number }>>`
    SELECT a."metadata"->>'templateKey' AS "key", COUNT(DISTINCT a."entityId")::int AS "count"
    FROM "AuditLog" a
    JOIN "RegistrationForm" f ON f."id" = a."entityId"
    WHERE a."entityType" = 'RegistrationForm'
      AND a."action" IN (${Prisma.join(usageActions)})
      AND a."metadata"->>'templateKey' IS NOT NULL
      AND (${key ?? null}::text IS NULL OR a."metadata"->>'templateKey' = ${key ?? null}::text)
    GROUP BY 1`;
  return new Map(rows.map((row) => [row.key, Number(row.count)]));
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
  const counts = await usedByFormCounts();
  return keys.map((key): FormTemplateLibraryEntry => {
    const row = rowByKey.get(key);
    const fromCode = code.find((template) => template.key === key);
    if (!row) {
      // Not synced yet: the code's copy is what the app uses.
      return { key, name: fromCode!.name, audience: fromCode!.audience, version: fromCode!.version ?? 1, source: "CODE", usedByForms: (counts.get(key) ?? 0), unreadable: false, appCreated: false, updatedAt: null, updatedBy: null };
    }
    const readable = registrationFormDefinitionSchema.safeParse(row.definition).success;
    const latestApp = row.latestSource === "APP" ? latestAppVersions.find((version) => version.templateId === row.id && version.version === row.version) : undefined;
    return {
      key, name: row.name, audience: row.audience, version: readable ? row.version : null, source: row.latestSource, usedByForms: (counts.get(key) ?? 0),
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
  const usedByForms = (await usedByFormCounts(key)).get(key) ?? 0;
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
 * Validates a definition for storage in a template, through the same schema forms use, and returns it ready to store:
 * explicit sensitive flags, no event-specific policy-version acknowledgments, no reserved choice values. Every path that
 * writes a template runs this.
 */
function prepareTemplateDefinition(raw: unknown): RegistrationFormDefinition {
  const parsed = registrationFormDefinitionSchema.safeParse(raw);
  if (!parsed.success) throw new FormTemplateError("INVALID_TEMPLATE", parsed.error.issues[0]?.message ?? "The form definition is not valid.");
  const definition = withExplicitSensitiveFlags(parsed.data);
  assertTemplateHasNoPolicyVersions(definition);
  try {
    assertNoReservedChoiceValues(definition);
  } catch (error) {
    throw new FormTemplateError("INVALID_TEMPLATE", error instanceof Error ? error.message : "The form definition is not valid.");
  }
  return definition;
}

/** Where a template version written from a form came from: ids only, recorded in the audit entry. */
type FormOrigin = { eventId: string; formId: string; formVersionId: string };

const versionConflict = () => new FormTemplateError("VERSION_CONFLICT", "This template was changed in another session. Reload it before saving again.");

/** Adds the next version of a template inside the write lock. A code template that has not been synced yet is stored at its code version first. */
async function addTemplateVersion(
  tx: Prisma.TransactionClient,
  key: string,
  input: { expectedVersion: number; name: string; description: string; audience: string },
  definition: RegistrationFormDefinition,
  actorUserId: string,
  origin?: FormOrigin,
) {
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
  if (row.version !== input.expectedVersion) throw versionConflict();
  const version = row.version + 1;
  const data = { name: input.name, description: input.description, audience: input.audience, definition: definition as unknown as Prisma.InputJsonValue };
  const created = await tx.seededFormTemplateVersion.create({ data: { templateId: row.id, version, ...data, source: "APP", createdByUserId: actorUserId } });
  await tx.seededFormTemplate.update({ where: { id: row.id }, data: { ...data, version, latestSource: "APP" } });
  await tx.auditLog.create({ data: {
    actorUserId, ...(origin ? { eventId: origin.eventId } : {}), action: "FORM_TEMPLATE_VERSION_SAVED", entityType: "FormTemplate", entityId: row.id, correlationId: randomUUID(),
    summary: origin ? "Saved a new version of a form template from a registration form." : "Saved a new version of a form template.",
    metadata: {
      templateKey: key, versionId: created.id, versionNumber: version, previousVersionNumber: row.version, source: "APP",
      ...(origin ? { sourceFormId: origin.formId, sourceFormVersionId: origin.formVersionId } : {}), productionWrite: false,
    },
  } });
  return { key, version, versionId: created.id };
}

/** Rewrites a version collision on (templateId, version) as the readable conflict the loser reloads from. */
function asVersionConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return versionConflict();
  return error;
}

/**
 * Saves a new immutable version of a template as the system administrator `actorUserId` and makes it the latest, marked as
 * coming from the app so `form-templates:sync` leaves it alone from then on. A code template that has not been synced yet
 * is stored at its code version first, in the same transaction. The previous versions are kept untouched.
 */
export async function saveFormTemplateVersion(key: string, input: SaveFormTemplateInput, actorUserId: string) {
  // Validate before any write, through the same definition schema forms use.
  const definition = prepareTemplateDefinition(input.definition);
  try {
    return await writeTransaction((tx) => addTemplateVersion(tx, key, input, definition, actorUserId));
  } catch (error) {
    throw asVersionConflict(error);
  }
}

/** Creates a template row and its version 1 (from the app) inside the write lock, with the audit entry. */
async function createAppTemplate(
  tx: Prisma.TransactionClient,
  input: { name: string; description: string; audience: string; definition: RegistrationFormDefinition },
  actorUserId: string,
  audit: { summary: string; eventId?: string; metadata: Record<string, Prisma.InputJsonValue> },
) {
  const taken = new Set([...codeFormTemplates().map((template) => template.key), ...(await tx.seededFormTemplate.findMany({ select: { key: true } })).map((row) => row.key)]);
  const key = newFormTemplateKey(input.name, taken);
  const data = { name: input.name, description: input.description, audience: input.audience, definition: input.definition as unknown as Prisma.InputJsonValue };
  const row = await tx.seededFormTemplate.create({ data: { key, version: 1, ...data, latestSource: "APP" } });
  const created = await tx.seededFormTemplateVersion.create({ data: { templateId: row.id, version: 1, ...data, source: "APP", createdByUserId: actorUserId } });
  await tx.auditLog.create({ data: {
    actorUserId, ...(audit.eventId ? { eventId: audit.eventId } : {}), action: "FORM_TEMPLATE_CREATED", entityType: "FormTemplate", entityId: row.id, correlationId: randomUUID(),
    summary: audit.summary,
    metadata: { templateKey: key, ...audit.metadata, versionId: created.id, versionNumber: 1, source: "APP", productionWrite: false },
  } });
  return { key, version: 1 };
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
    // The same rule a save applies: a copy never carries an event's policy version into a template.
    assertTemplateHasNoPolicyVersions(source.definition);
    return createAppTemplate(tx, { name: input.name, description: source.description, audience: source.audience, definition: source.definition }, actorUserId, {
      summary: "Created a form template as a copy of another.", metadata: { copiedFromKey: input.sourceKey },
    });
  });
}

export type SaveFormAsTemplateResult = {
  key: string;
  version: number;
  created: boolean;
  /** Labels of acknowledgments that pointed at the event's policy version and now carry placeholder wording to reword. */
  replacedAcknowledgments: string[];
};

/**
 * A system administrator turns a registration form into a template (#1065): a new APP template at version 1, or the next
 * version of an existing one, through the same advisory lock, versioning and audit path as every other template write. It
 * snapshots the one persisted form version named (never unsaved editor content), reading it inside the template lock, and
 * copies configuration only: no answers, registrations, test submissions, people or messages. Meal ticket prices stay as defaults: the event the template is used in overrides them from its own meal plan. Policy-version
 * acknowledgments are an event's, so each becomes typed placeholder wording and is reported. The form is not changed.
 */
export async function saveFormAsTemplate(input: SaveFormAsTemplateInput, actorUserId: string): Promise<SaveFormAsTemplateResult> {
  try {
    return await writeTransaction(async (tx) => {
      const version = await tx.registrationFormVersion.findFirst({
        where: { id: input.versionId, formId: input.formId, form: { eventId: input.eventId } },
        select: { id: true, definition: true },
      });
      if (!version) throw new FormTemplateError("FORM_NOT_FOUND", "That registration form version was not found.");
      const parsed = registrationFormDefinitionSchema.safeParse(version.definition);
      if (!parsed.success) throw new FormTemplateError("INVALID_TEMPLATE", "That form version's stored definition cannot be read, so it cannot be saved as a template.");
      const { definition: portable, replacedLabels } = replacePolicyVersionAcknowledgments(parsed.data);
      const definition = prepareTemplateDefinition(portable);
      const origin: FormOrigin = { eventId: input.eventId, formId: input.formId, formVersionId: version.id };
      if (input.mode === "NEW") {
        const created = await createAppTemplate(tx, { name: input.name, description: input.description, audience: input.audience, definition }, actorUserId, {
          summary: "Created a form template from a registration form.", eventId: input.eventId,
          metadata: { sourceFormId: origin.formId, sourceFormVersionId: origin.formVersionId },
        });
        return { ...created, created: true, replacedAcknowledgments: replacedLabels };
      }
      // A new version keeps the template's own name, description and audience: the form's title is not the template's name.
      const current = await loadFormTemplate(tx, input.templateKey);
      if (!current) throw new FormTemplateError("TEMPLATE_NOT_FOUND", "That form template was not found.");
      const saved = await addTemplateVersion(tx, input.templateKey, { expectedVersion: input.expectedVersion, name: current.name, description: current.description, audience: current.audience }, definition, actorUserId, origin);
      return { key: saved.key, version: saved.version, created: false, replacedAcknowledgments: replacedLabels };
    });
  } catch (error) {
    throw asVersionConflict(error);
  }
}
