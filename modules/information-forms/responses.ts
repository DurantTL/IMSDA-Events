import "server-only";

import { InformationFormStatus, InformationFormVersionStatus, Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { fieldDisplayLabel, isFieldVisible, validateTestResponses } from "@/modules/forms/definition";
import { parseInformationFormDefinition, parseStoredInformationFormDefinition, informationFormFields, type InformationFormDefinition } from "@/modules/information-forms/definition";
import { scopeWhere, type InformationFormTarget } from "@/modules/information-forms/domain";
import { InformationFormError } from "@/modules/information-forms/errors";
import { isNotificationEnabled } from "@/modules/notifications/settings";
import { sendInformationFormSubmittedAlert } from "@/modules/information-forms/submission-alert";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { toCsv } from "@/modules/reporting/csv";

/** One member row with its text trimmed and a typed-in age as a number; anything unexpected is left for the validator to refuse. */
export function normalizeMemberRow(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => {
    if (typeof value !== "string") return [key, value];
    const text = value.trim();
    return [key, key === "age" && /^\d{1,3}$/.test(text) ? Number(text) : text];
  }));
}

/** One answer, labelled from the version it was answered on. */
export type LabelledAnswer = { key: string; label: string; type: string; value: unknown };

/** Past this many responses an export is refused rather than silently cut short. */
export const MAX_EXPORT_ROWS = 20_000;

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

/** A member row as one readable line: name, age, level, working on. */
export function memberRowText(row: unknown): string {
  if (!row || typeof row !== "object" || Array.isArray(row)) return String(row);
  const record = row as Record<string, unknown>;
  return ["name", "age", "level", "working_on"].map((key) => record[key]).filter((part) => part !== undefined && part !== null && part !== "").map(String).join(", ");
}

function formatCell(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => (item && typeof item === "object" ? memberRowText(item) : String(item))).join("; ");
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
    answers: labelAnswers(parseStoredInformationFormDefinition(row.version.definition), answersOf(row.answers)),
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
export async function buildInformationFormResponsesCsv(target: InformationFormTarget, formId: string, actorUserId: string) {
  const form = await assertFormInTarget(target, formId);
  const prisma = getPrisma();
  const total = await prisma.informationFormResponse.count({ where: { formId } });
  if (total > MAX_EXPORT_ROWS) {
    throw new InformationFormError("EXPORT_TOO_LARGE", `This form has ${total.toLocaleString("en-US")} responses, more than the ${MAX_EXPORT_ROWS.toLocaleString("en-US")} one export can hold. Ask a developer for a bulk export.`);
  }
  const versions = await prisma.informationFormVersion.findMany({
    where: { formId, status: { not: InformationFormVersionStatus.DRAFT } },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true, definition: true },
  });
  // Newest version first, so its label wins; column order follows the newest definition, then older-only fields.
  const columns = new Map<string, string>();
  for (const version of versions) {
    for (const field of informationFormFields(parseStoredInformationFormDefinition(version.definition))) {
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
  // Counts and ids only; no answer ever reaches the audit log.
  await writeAuditLog({
    ...(target.scope === "EVENT" ? { eventId: target.eventId } : {}),
    actorUserId, action: "INFORMATION_FORM_RESPONSES_EXPORTED", entityType: "InformationForm", entityId: formId,
    summary: `Exported ${rows.length} response${rows.length === 1 ? "" : "s"} of ${form.name}.`,
    metadata: { formId, scope: target.scope, rowCount: rows.length, productionWrite: false },
  });
  return { csv, filename: `${form.slug}-responses.csv`, rowCount: rows.length };
}

/** The key of a form's member list field in a definition, if it has one. */
export function memberListFieldKeys(definition: InformationFormDefinition): string[] {
  return informationFormFields(definition).filter((field) => field.type === "MEMBER_LIST").map((field) => field.key);
}

/**
 * Every member of every response as CSV, one row per member (#1222): club, name, age, level, working on, so the list can be
 * imported into Adventurer rosters later (#840). The club is the response's `club_name` answer. A response with no members
 * adds no row. Cells go through the same formula-safe escaper as the response export.
 */
export async function buildInformationFormMembersCsv(target: InformationFormTarget, formId: string, actorUserId: string) {
  const form = await assertFormInTarget(target, formId);
  const prisma = getPrisma();
  const total = await prisma.informationFormResponse.count({ where: { formId } });
  if (total > MAX_EXPORT_ROWS) {
    throw new InformationFormError("EXPORT_TOO_LARGE", `This form has ${total.toLocaleString("en-US")} responses, more than the ${MAX_EXPORT_ROWS.toLocaleString("en-US")} one export can hold. Ask a developer for a bulk export.`);
  }
  const versions = await prisma.informationFormVersion.findMany({
    where: { formId, status: { not: InformationFormVersionStatus.DRAFT } },
    select: { definition: true },
  });
  const memberKeys = new Set(versions.flatMap((version) => memberListFieldKeys(parseStoredInformationFormDefinition(version.definition))));
  if (memberKeys.size === 0) throw new InformationFormError("INVALID_REQUEST", "This form has no member list to export.");
  const responses = await prisma.informationFormResponse.findMany({
    where: { formId }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: MAX_EXPORT_ROWS,
    select: { answers: true },
  });
  const rows: Array<Array<string | number>> = [];
  for (const response of responses) {
    const answers = answersOf(response.answers);
    const club = formatCell(answers.club_name);
    for (const key of memberKeys) {
      const members = answers[key];
      if (!Array.isArray(members)) continue;
      for (const member of members) {
        const record = member && typeof member === "object" && !Array.isArray(member) ? member as Record<string, unknown> : {};
        rows.push([club, formatCell(record.name), formatCell(record.age), formatCell(record.level), formatCell(record.working_on)]);
      }
    }
  }
  const csv = toCsv([["Club", "Name", "Age", "Level", "Working on"], ...rows]);
  // Counts and ids only; no answer ever reaches the audit log.
  await writeAuditLog({
    ...(target.scope === "EVENT" ? { eventId: target.eventId } : {}),
    actorUserId, action: "INFORMATION_FORM_RESPONSES_EXPORTED", entityType: "InformationForm", entityId: formId,
    summary: `Exported ${rows.length} member row${rows.length === 1 ? "" : "s"} from ${responses.length} response${responses.length === 1 ? "" : "s"} of ${form.name}.`,
    metadata: { formId, scope: target.scope, rowCount: rows.length, format: "members", productionWrite: false },
  });
  return { csv, filename: `${form.slug}-members.csv`, rowCount: rows.length };
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
  // A member list's rows are tidied (trimmed text, a typed age) so the stored answer and its export read the same everywhere.
  for (const field of informationFormFields(definition)) {
    const rows = answers[field.key];
    if (field.type === "MEMBER_LIST" && Array.isArray(rows)) answers[field.key] = rows.map(normalizeMemberRow);
  }
  const check = validateTestResponses(definition, answers, {}, undefined, { ignoreAvailability: true });
  if (!check.isValid) throw new InformationFormError("ANSWERS_INVALID", check.issues[0]!.message, check.issues.map((issue) => ({ key: issue.key, message: issue.message })));
  // Read before the response is written; a failed read counts as on (the settings module's own rule).
  const alertEnabled = await isNotificationEnabled("INFORMATION_FORM_SUBMITTED");
  try {
    const created = await prisma.informationFormResponse.create({ data: {
      formId: form.id, versionId: version.id, answers: answers as Prisma.InputJsonValue,
      attendeeAccountId: input.attendeeAccountId ?? null,
      idempotencyKey: input.idempotencyKey,
    }, select: { id: true, submittedAt: true } });
    // After the response is stored, and never throwing: the saved response stands whatever happens to the alert (#1222).
    await sendInformationFormSubmittedAlert({ responseId: created.id, formId: form.id, submittedAt: created.submittedAt }, alertEnabled);
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
