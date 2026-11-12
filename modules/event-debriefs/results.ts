import "server-only";

import { getPrisma } from "@/lib/prisma";
import { requirePermission, type Session } from "@/modules/access/authorization";
import { findActiveMembership } from "@/modules/events/repository";
import { informationFormFields, parseStoredInformationFormDefinition } from "@/modules/information-forms/definition";
import { DEBRIEF_FORM_TITLES, DEBRIEF_MODULE_KEY, type DebriefFormPurpose } from "@/modules/event-debriefs/domain";
import { answeredAccountIds, resolveDebriefRecipients } from "@/modules/event-debriefs/recipients";

/**
 * Who may read the debrief's answers (#1679): event staff holding MANAGE_FORMS on the event (the permission that already
 * opens an event's information form responses, held by Event Admins and Registration Managers) and system administrators.
 * An Area Coordinator or the Clubs Administrator reads them only when they are also event staff with that permission.
 * Checked on the server for every read, and for the source event too when last year's answers are shown.
 */
export async function canReadDebriefAnswers(session: Session, eventId: string): Promise<boolean> {
  try {
    await requirePermission(session, eventId, "MANAGE_FORMS", findActiveMembership);
    return true;
  } catch {
    return false;
  }
}

export type DebriefAnswerRow = { question: string; answer: string };
export type DebriefResponseRow = { id: string; who: string; submittedAt: string; answers: DebriefAnswerRow[] };
export type DebriefFormResults = {
  purpose: DebriefFormPurpose;
  title: string;
  formId: string;
  asked: number;
  answered: number;
  responses: DebriefResponseRow[];
  /** Whether a person on the list has not answered: counted, never named, so the list is not a way to chase anyone. */
  waiting: number;
};
export type DebriefResults = { eventId: string; eventName: string; moduleOn: boolean; forms: DebriefFormResults[] };

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

const MAX_RESPONSES = 200;

/** The answers of an event's debrief and director evaluation. The caller has already checked `canReadDebriefAnswers`. */
export async function loadDebriefResults(eventId: string, now = new Date()): Promise<DebriefResults | null> {
  const prisma = getPrisma();
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, name: true } });
  if (!event) return null;
  const [moduleRow, forms] = await Promise.all([
    prisma.eventModule.findUnique({ where: { eventId_moduleKey: { eventId, moduleKey: DEBRIEF_MODULE_KEY } }, select: { id: true } }),
    prisma.informationForm.findMany({ where: { eventId, purpose: { not: null } }, select: { id: true, purpose: true }, orderBy: { purpose: "asc" } }),
  ]);
  const results: DebriefFormResults[] = [];
  for (const form of forms) {
    if (form.purpose !== "DEBRIEF" && form.purpose !== "DIRECTOR_EVALUATION") continue;
    const purpose = form.purpose;
    const rows = await prisma.informationFormResponse.findMany({
      where: { formId: form.id },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: MAX_RESPONSES,
      select: { id: true, answers: true, submittedAt: true, attendeeAccount: { select: { displayName: true } }, version: { select: { definition: true } } },
    });
    const [audience, answered] = await Promise.all([resolveDebriefRecipients(prisma, eventId, purpose, now), answeredAccountIds(prisma, eventId, purpose)]);
    results.push({
      purpose,
      title: DEBRIEF_FORM_TITLES[purpose],
      formId: form.id,
      asked: audience.length,
      answered: rows.length,
      waiting: audience.filter((recipient) => !answered.has(recipient.accountId)).length,
      responses: rows.map((row) => {
        const answers = row.answers && typeof row.answers === "object" && !Array.isArray(row.answers) ? row.answers as Record<string, unknown> : {};
        const fields = informationFormFields(parseStoredInformationFormDefinition(row.version.definition));
        return {
          id: row.id,
          who: row.attendeeAccount?.displayName?.trim() || "A person who has since left",
          submittedAt: row.submittedAt.toISOString(),
          answers: fields.map((field) => ({ question: field.label, answer: text(answers[field.key]) })).filter((entry) => entry.answer !== ""),
        };
      }),
    });
  }
  return { eventId, eventName: event.name, moduleOn: moduleRow !== null, forms: results };
}

/**
 * Last year's debrief, for an event that is a copy of one that had it: the source event's answers, shown read only. Null when
 * there is no source, or when the viewer may not read the source event's answers (checked against that event, not this one).
 */
export async function loadCarriedDebriefResults(session: Session, eventId: string, now = new Date()): Promise<{ sourceEventId: string; results: DebriefResults } | null> {
  const settings = await getPrisma().eventDebrief.findUnique({ where: { eventId }, select: { carriedFromEventId: true } });
  const sourceEventId = settings?.carriedFromEventId;
  if (!sourceEventId) return null;
  if (!(await canReadDebriefAnswers(session, sourceEventId))) return null;
  const results = await loadDebriefResults(sourceEventId, now);
  return results ? { sourceEventId, results } : null;
}
