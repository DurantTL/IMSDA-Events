import "server-only";

import { randomUUID } from "node:crypto";
import {
  InformationFormFillAccess,
  InformationFormScope,
  InformationFormStatus,
  InformationFormVersionStatus,
  Prisma,
} from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isLockTimeoutError } from "@/lib/prisma-errors";
import { loadFormTemplate } from "@/modules/forms/seeded-templates";
import { slugCandidate, slugify } from "@/modules/forms/slug";
import { blankInformationFormDefinition, parseInformationFormDefinition, type InformationFormDefinition } from "@/modules/information-forms/definition";
import { scopeKeyFor, scopeWhere, type InformationFormTarget } from "@/modules/information-forms/domain";
import { InformationFormError } from "@/modules/information-forms/errors";

/**
 * Information forms (#1148): survey and interest forms that gather answers only. Every read and write takes the
 * target (GENERAL, or one event) and finds the form inside it, so an id from another scope is simply "not found".
 * Who may call these is decided by the route (system administrator, or MANAGE_FORMS on the event).
 */

const NOT_FOUND = "That information form was not found.";

async function writeTransaction<T>(target: InformationFormTarget, formId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await getPrisma().$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "InformationForm" WHERE "id" = ${formId} AND "scopeKey" = ${scopeKeyFor(target)} FOR UPDATE`;
      await tx.$executeRaw`SET LOCAL lock_timeout = 0`;
      if (locked.length === 0) throw new InformationFormError("FORM_NOT_FOUND", NOT_FOUND);
      return operation(tx);
    }, { timeout: 10_000 });
  } catch (error) {
    if (isLockTimeoutError(error) || (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2028" || error.code === "P2034"))) {
      throw new InformationFormError("FORM_BUSY", "This form is being changed by someone else right now. Wait a moment and try again.");
    }
    throw error;
  }
}

function conflictOnDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new InformationFormError("EDIT_CONFLICT", "This form was just changed in another session. Reload it and try again.");
  }
  throw error;
}

function definitionOf(value: Prisma.JsonValue): InformationFormDefinition {
  return parseInformationFormDefinition(value);
}

const formInclude = { versions: { orderBy: { versionNumber: "desc" as const } } } satisfies Prisma.InformationFormInclude;

function audit(tx: Prisma.TransactionClient, target: InformationFormTarget, actorUserId: string, formId: string, action: string, summary: string, metadata: Record<string, Prisma.InputJsonValue>) {
  return tx.auditLog.create({ data: {
    ...(target.scope === "EVENT" ? { eventId: target.eventId } : {}),
    actorUserId, action, entityType: "InformationForm", entityId: formId,
    correlationId: randomUUID(), summary, metadata: { scope: target.scope, ...metadata, productionWrite: false },
  } });
}

export async function listInformationForms(target: InformationFormTarget) {
  const forms = await getPrisma().informationForm.findMany({
    where: scopeWhere(target),
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { _count: { select: { responses: true } }, versions: { select: { id: true, versionNumber: true, status: true, publishedAt: true, updatedAt: true }, orderBy: { versionNumber: "desc" } } },
  });
  return forms.map(({ _count, ...form }) => ({ ...form, responseCount: _count.responses }));
}

export async function getInformationForm(target: InformationFormTarget, formId: string) {
  const form = await getPrisma().informationForm.findFirst({ where: { id: formId, ...scopeWhere(target) }, include: formInclude });
  if (!form) throw new InformationFormError("FORM_NOT_FOUND", NOT_FOUND);
  return form;
}

/** Creates a DRAFT form (version 1) from a stored template, a given definition, or a blank starter. */
export async function createInformationForm(
  target: InformationFormTarget,
  actorUserId: string,
  input: { name: string; fillAccess?: InformationFormFillAccess; templateKey?: string; definition?: unknown },
) {
  const prisma = getPrisma();
  let definition: InformationFormDefinition;
  let sourceTemplateVersionId: string | null = null;
  if (input.templateKey) {
    const template = await loadFormTemplate(prisma, input.templateKey);
    if (!template) throw new InformationFormError("TEMPLATE_NOT_FOUND", "That form template is not available.");
    definition = parseInformationFormDefinition({ ...structuredClone(template.definition), title: input.name });
    sourceTemplateVersionId = template.versionId ?? null;
  } else {
    definition = input.definition === undefined
      ? blankInformationFormDefinition(input.name)
      : parseInformationFormDefinition({ ...(input.definition as object), title: input.name });
  }
  const baseSlug = slugify(input.name);
  const scopeKey = scopeKeyFor(target);
  for (let suffix = 1; suffix < 50; suffix += 1) {
    const slug = slugCandidate(baseSlug, suffix);
    try {
      return await prisma.$transaction(async (tx) => {
        const form = await tx.informationForm.create({
          data: {
            scope: target.scope === "EVENT" ? InformationFormScope.EVENT : InformationFormScope.GENERAL,
            eventId: target.scope === "EVENT" ? target.eventId : null,
            scopeKey, name: input.name, slug,
            fillAccess: input.fillAccess ?? InformationFormFillAccess.ANYONE_WITH_LINK,
            createdByUserId: actorUserId,
            sourceTemplateVersionId,
            versions: { create: { createdByUserId: actorUserId, versionNumber: 1, definition: definition as Prisma.InputJsonValue } },
          },
          include: formInclude,
        });
        await audit(tx, target, actorUserId, form.id, "INFORMATION_FORM_CREATED", `Created the information form ${form.name}.`, { slug, ...(input.templateKey ? { templateKey: input.templateKey } : {}) });
        return form;
      });
    } catch (error) {
      // Another form already uses this address in this scope; try the next one.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }
  throw new InformationFormError("FORM_SLUG_TAKEN", "That web address is already used by another form. Choose a different name.");
}

/**
 * Saves the draft. With a draft in place its definition is replaced, but only when `expectedUpdatedAt` is still the
 * draft's own timestamp. With none (the latest version is published) a new draft version is created from the edit, so a
 * published version is never changed.
 */
export async function saveInformationFormDraft(
  target: InformationFormTarget,
  formId: string,
  actorUserId: string,
  input: { definition: unknown; expectedUpdatedAt: string },
) {
  const definition = parseInformationFormDefinition(input.definition);
  const expected = new Date(input.expectedUpdatedAt);
  try {
    await writeTransaction(target, formId, async (tx) => {
      const form = await tx.informationForm.findFirst({ where: { id: formId, ...scopeWhere(target) }, include: formInclude });
      if (!form) throw new InformationFormError("FORM_NOT_FOUND", NOT_FOUND);
      const draft = form.versions.find((version) => version.status === InformationFormVersionStatus.DRAFT);
      const conflict = () => new InformationFormError("EDIT_CONFLICT", "This draft changed in another session. Reload it before saving again.");
      if (draft) {
        if (draft.updatedAt.getTime() !== expected.getTime()) throw conflict();
        const saved = await tx.informationFormVersion.updateMany({
          where: { id: draft.id, status: InformationFormVersionStatus.DRAFT, updatedAt: expected },
          data: { definition: definition as Prisma.InputJsonValue, createdByUserId: actorUserId },
        });
        if (saved.count !== 1) throw conflict();
      } else {
        const latest = form.versions[0];
        if (!latest) throw new InformationFormError("NO_DRAFT", "This form has no version to edit.");
        if (latest.updatedAt.getTime() !== expected.getTime()) throw conflict();
        await tx.informationFormVersion.create({ data: {
          formId, createdByUserId: actorUserId, versionNumber: latest.versionNumber + 1,
          status: InformationFormVersionStatus.DRAFT, definition: definition as Prisma.InputJsonValue,
        } });
      }
      await tx.informationForm.update({ where: { id: formId }, data: { name: definition.title } });
      await audit(tx, target, actorUserId, formId, "INFORMATION_FORM_DRAFT_SAVED", `Saved a draft of ${definition.title}.`, { sectionCount: definition.sections.length });
    });
  } catch (error) {
    conflictOnDuplicate(error);
  }
  return getInformationForm(target, formId);
}

/** Publishes the draft: it becomes immutable, and any earlier published version is superseded. */
export async function publishInformationForm(target: InformationFormTarget, formId: string, actorUserId: string, expectedUpdatedAt?: string) {
  await writeTransaction(target, formId, async (tx) => {
    const form = await tx.informationForm.findFirst({ where: { id: formId, ...scopeWhere(target) }, include: formInclude });
    if (!form) throw new InformationFormError("FORM_NOT_FOUND", NOT_FOUND);
    const draft = form.versions.find((version) => version.status === InformationFormVersionStatus.DRAFT);
    if (!draft) throw new InformationFormError("NO_DRAFT", "This form has no draft version to publish.");
    if (expectedUpdatedAt && draft.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new InformationFormError("EDIT_CONFLICT", "This draft changed in another session. Reload it before publishing.");
    }
    // Re-checked on publish, so a definition stored before a rule tightened can never go live.
    const definition = definitionOf(draft.definition);
    await tx.informationFormVersion.updateMany({ where: { formId, status: InformationFormVersionStatus.PUBLISHED }, data: { status: InformationFormVersionStatus.SUPERSEDED } });
    const promoted = await tx.informationFormVersion.updateMany({
      where: { id: draft.id, status: InformationFormVersionStatus.DRAFT, updatedAt: draft.updatedAt },
      data: { status: InformationFormVersionStatus.PUBLISHED, publishedAt: new Date() },
    });
    if (promoted.count !== 1) throw new InformationFormError("EDIT_CONFLICT", "This draft changed while it was being published. Reload it and publish again.");
    await tx.informationForm.update({ where: { id: formId }, data: { name: definition.title } });
    await audit(tx, target, actorUserId, formId, "INFORMATION_FORM_PUBLISHED", `Published ${definition.title} version ${draft.versionNumber}.`, { versionId: draft.id, versionNumber: draft.versionNumber });
  });
  return getInformationForm(target, formId);
}

/** Opens (needs a published version) or closes the form to answers. */
export async function setInformationFormStatus(target: InformationFormTarget, formId: string, actorUserId: string, status: "OPEN" | "CLOSED") {
  await writeTransaction(target, formId, async (tx) => {
    const form = await tx.informationForm.findFirst({ where: { id: formId, ...scopeWhere(target) }, include: formInclude });
    if (!form) throw new InformationFormError("FORM_NOT_FOUND", NOT_FOUND);
    if (status === "OPEN" && !form.versions.some((version) => version.status === InformationFormVersionStatus.PUBLISHED)) {
      throw new InformationFormError("NOT_PUBLISHED", "Publish this form before opening it.");
    }
    await tx.informationForm.update({ where: { id: formId }, data: { status: status === "OPEN" ? InformationFormStatus.OPEN : InformationFormStatus.CLOSED } });
    await audit(tx, target, actorUserId, formId, status === "OPEN" ? "INFORMATION_FORM_OPENED" : "INFORMATION_FORM_CLOSED", `${status === "OPEN" ? "Opened" : "Closed"} ${form.name} for answers.`, { previousStatus: form.status });
  });
  return getInformationForm(target, formId);
}

/** Name, who may fill it, and the optional open and close times. */
export async function updateInformationFormSettings(
  target: InformationFormTarget,
  formId: string,
  actorUserId: string,
  input: { fillAccess?: InformationFormFillAccess; opensAt?: Date | null; closesAt?: Date | null },
) {
  await writeTransaction(target, formId, async (tx) => {
    const form = await tx.informationForm.findFirst({ where: { id: formId, ...scopeWhere(target) } });
    if (!form) throw new InformationFormError("FORM_NOT_FOUND", NOT_FOUND);
    const opensAt = input.opensAt === undefined ? form.opensAt : input.opensAt;
    const closesAt = input.closesAt === undefined ? form.closesAt : input.closesAt;
    if (opensAt && closesAt && closesAt.getTime() <= opensAt.getTime()) {
      throw new InformationFormError("INVALID_REQUEST", "The closing time must be after the opening time.");
    }
    await tx.informationForm.update({ where: { id: formId }, data: {
      ...(input.fillAccess !== undefined ? { fillAccess: input.fillAccess } : {}),
      ...(input.opensAt !== undefined ? { opensAt: input.opensAt } : {}),
      ...(input.closesAt !== undefined ? { closesAt: input.closesAt } : {}),
    } });
    await audit(tx, target, actorUserId, formId, "INFORMATION_FORM_SETTINGS_UPDATED", `Updated the settings of ${form.name}.`, { fields: Object.keys(input) });
  });
  return getInformationForm(target, formId);
}
