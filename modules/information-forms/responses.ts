import "server-only";

import { InformationFormStatus, InformationFormVersionStatus, Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { fieldDisplayLabel, isFieldVisible, validateTestResponses } from "@/modules/forms/definition";
import { parseInformationFormDefinition, informationFormFields, type InformationFormDefinition } from "@/modules/information-forms/definition";
import { scopeWhere, type InformationFormTarget } from "@/modules/information-forms/domain";
import { InformationFormError } from "@/modules/information-forms/errors";
import { toCsv } from "@/modules/reporting/csv";

/** One answer, labelled from the version it was answered on. */
export type LabelledAnswer = { key: string; label: string; type: string; value: unknown };

const MAX_EXPORT_ROWS = 20_000;

/**
 * The answers of one response, labelled by the definition of the version they were answered on (#1148). A field a later
 * version dropped is still listed, under the label it had then; only keys that version never had are left out.
 */
export function labelAnswers(definition: InformationFormDefinition, answers: Record<string, unknown>): LabelledAnswer[] {
  return informationFormFields(definition).flatMap((field) => {
    const value = answers[field.key];
    if (value === undefined || value === null || value === "") return [];
    return [{ key: field.key, label: fieldDisplayLabel(field), type: field.type, value }];
  });
}

function answersOf(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function formatCell(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join("; ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value && typeof value === "object") return JSON.stringify(value);
  return value === undefined || value === null ? "" : String(value);
}

type ResponseRow = {
  id: string;
  versionId: string;
  answers: Prisma.JsonValue;
  attendeeAccountId: string | null;
  submittedAt: Date;
  version: { versionNumber: number; definition: Prisma.JsonValue };
};

function present(row: ResponseRow) {
  return {
    id: row.id,
    versionId: row.versionId,
    versionNumber: row.version.versionNumber,
    submittedAt: row.submittedAt,
    signedIn: row.attendeeAccountId !== null,
    answers: labelAnswers(parseInformationFormDefinition(row.version.definition), answersOf(row.answers)),
  };
}

async function assertFormInTarget(target: InformationFormTarget, formId: string) {
  const form = await getPrisma().informationForm.findFirst({ where: { id: formId, ...scopeWhere(target) }, select: { id: true, name: true, slug: true } });
  if (!form) throw new InformationFormError("FORM_NOT_FOUND", "That information form was not found.");
  return form;
}

const responseSelect = {
  id: true, versionId: true, answers: true, attendeeAccountId: true, submittedAt: true,
  version: { select: { versionNumber: true, definition: true } },
} satisfies Prisma.InformationFormResponseSelect;

/** Newest first, a page at a time; `nextCursor` is the id to pass for the next page. */
export async function listInformationFormResponses(target: InformationFormTarget, formId: string, options: { limit: number; cursor?: string }) {
  await assertFormInTarget(target, formId);
  const rows = await getPrisma().informationFormResponse.findMany({
    where: { formId },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: responseSelect,
  });
  const page = rows.slice(0, options.limit);
  return {
    responses: page.map(present),
    nextCursor: rows.length > options.limit ? page[page.length - 1]!.id : null,
    total: await getPrisma().informationFormResponse.count({ where: { formId } }),
  };
}

export async function getInformationFormResponse(target: InformationFormTarget, formId: string, responseId: string) {
  await assertFormInTarget(target, formId);
  const row = await getPrisma().informationFormResponse.findFirst({ where: { id: responseId, formId }, select: responseSelect });
  if (!row) throw new InformationFormError("RESPONSE_NOT_FOUND", "That response was not found.");
  return present(row);
}

/**
 * Every response as CSV. Columns cover every version of the form: a field a later version dropped keeps its column,
 * headed by the label of the newest version that still had it. Cells go through the formula-safe escaper.
 */
export async function buildInformationFormResponsesCsv(target: InformationFormTarget, formId: string) {
  const form = await assertFormInTarget(target, formId);
  const prisma = getPrisma();
  const versions = await prisma.informationFormVersion.findMany({
    where: { formId, status: { not: InformationFormVersionStatus.DRAFT } },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true, definition: true },
  });
  // Newest version first, so its label wins; column order follows the newest definition, then older-only fields.
  const columns = new Map<string, string>();
  for (const version of versions) {
    for (const field of informationFormFields(parseInformationFormDefinition(version.definition))) {
      if (!columns.has(field.key)) columns.set(field.key, fieldDisplayLabel(field));
    }
  }
  const rows = await prisma.informationFormResponse.findMany({
    where: { formId }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: MAX_EXPORT_ROWS,
    select: { answers: true, attendeeAccountId: true, submittedAt: true, version: { select: { versionNumber: true } } },
  });
  const keys = [...columns.keys()];
  const csv = toCsv([
    ["Submitted at", "Form version", "Signed in", ...keys.map((key) => columns.get(key)!)],
    ...rows.map((row) => {
      const answers = answersOf(row.answers);
      return [row.submittedAt.toISOString(), row.version.versionNumber, row.attendeeAccountId ? "Yes" : "No", ...keys.map((key) => formatCell(answers[key]))];
    }),
  ]);
  return { csv, filename: `${form.slug}-responses.csv`, rowCount: rows.length };
}

/**
 * Stores one submitted response against the form's current published version (#1148). The same `idempotencyKey` for the
 * same form stores once and returns the stored response, so a retried submit never doubles. Used by the public fill
 * page (part C); the caller has already decided who is allowed to answer, and passes the signed-in account if any.
 */
export async function storeInformationFormResponse(input: {
  formId: string;
  idempotencyKey: string;
  answers: Record<string, unknown>;
  attendeeAccountId?: string | null;
  now?: Date;
}) {
  const prisma = getPrisma();
  const now = input.now ?? new Date();
  const form = await prisma.informationForm.findUnique({
    where: { id: input.formId },
    include: { versions: { where: { status: InformationFormVersionStatus.PUBLISHED }, take: 1 } },
  });
  if (!form) throw new InformationFormError("FORM_NOT_FOUND", "That information form was not found.");
  const existing = await prisma.informationFormResponse.findUnique({ where: { formId_idempotencyKey: { formId: form.id, idempotencyKey: input.idempotencyKey } }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  const version = form.versions[0];
  const isOpen = form.status === InformationFormStatus.OPEN && version && (!form.opensAt || form.opensAt <= now) && (!form.closesAt || form.closesAt > now);
  if (!isOpen || !version) throw new InformationFormError("FORM_NOT_OPEN", "This form is not taking answers right now.");
  if (form.fillAccess === "SIGNED_IN" && !input.attendeeAccountId) throw new InformationFormError("SIGN_IN_REQUIRED", "Sign in to answer this form.");
  const definition = parseInformationFormDefinition(version.definition);
  // Only keys the version asks (and shows) are kept, so a stray key can never be stored.
  const answers: Record<string, unknown> = {};
  for (const field of informationFormFields(definition)) {
    if (isFieldVisible(field, input.answers) && input.answers[field.key] !== undefined) answers[field.key] = input.answers[field.key];
  }
  const check = validateTestResponses(definition, answers, {}, undefined, { ignoreAvailability: true });
  if (!check.isValid) throw new InformationFormError("ANSWERS_INVALID", check.issues[0]!.message, check.issues.map((issue) => ({ key: issue.key, message: issue.message })));
  try {
    const created = await prisma.informationFormResponse.create({ data: {
      formId: form.id, versionId: version.id, answers: answers as Prisma.InputJsonValue,
      attendeeAccountId: input.attendeeAccountId ?? null,
      idempotencyKey: input.idempotencyKey,
    }, select: { id: true } });
    return { id: created.id, created: true };
  } catch (error) {
    // A concurrent retry stored it first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.informationFormResponse.findUnique({ where: { formId_idempotencyKey: { formId: form.id, idempotencyKey: input.idempotencyKey } }, select: { id: true } });
      if (winner) return { id: winner.id, created: false };
    }
    throw error;
  }
}
