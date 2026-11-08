import { z } from "zod";
import { formatDateRange, isCalendarDate } from "@/modules/calendar/domain";
import { formatInTimeZone } from "@/modules/calendar/conference-format";
import { BIRTH_DATE_PATTERN, looksLikeMedicalFreeText } from "@/modules/club-registrations/domain";
import { ClubFormError } from "@/modules/club-forms/errors";
import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";

/**
 * Outing permission slips (#1672): the conference Off-Premises Permission Slip, with the details of one outing filled
 * in by the club's director and up to five club questions. This file is the pure part: the shapes, the refusal rules
 * for club questions, and how an outing changes the slip's definition. It never touches the slip's required sections:
 * the child and family, permission statement, medical and emergency and signature sections are the template's own.
 */

export const OUTING_TEMPLATE_KEY = "off_premises_permission_slip";
export const OUTING_MAX_QUESTIONS = 5;
export const OUTING_MAX_SEND = 100;
/** Mirrors `OUTING_SLIPS_PER_CLUB_DAY` in the rate limiter, for the words the director reads. */
export const OUTING_SLIPS_PER_DAY = 400;
/** The slip section whose three typed fields the outing presets. */
export const OUTING_PERMISSION_SECTION_ID = "sec_permission";
export const OUTING_QUESTIONS_SECTION_ID = "sec_outing_questions";
export const OUTING_QUESTION_TYPES = ["TEXT", "YES_NO", "CHOICE"] as const;
export type OutingQuestionType = (typeof OUTING_QUESTION_TYPES)[number];

/** The slip's typed fields that an outing presets, so a parent no longer types them. */
export const OUTING_PRESET_KEYS = { activity: "activity", date: "activity_date", rideWith: "ride_with" } as const;
const PRESET_KEY_SET: ReadonlySet<string> = new Set(Object.values(OUTING_PRESET_KEYS));

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const optionalText = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`).default("");

const dateText = (label: string) => z.string().trim().refine(isCalendarDate, `${label} must be a real date.`);
const optionalDate = (label: string) => z.string().trim().refine((value) => value === "" || isCalendarDate(value), `${label} must be a real date.`).default("");
const optionalTime = (label: string) => z.string().trim().refine((value) => value === "" || TIME_PATTERN.test(value), `${label} must be a time like 08:30.`).default("");

export const outingDetailsSchema = z.object({
  activity: z.string().trim().min(1, "Enter the activity.").max(120, "The activity can be 120 characters or fewer."),
  startDate: dateText("The date"),
  endDate: optionalDate("The last date"),
  departureTime: optionalTime("The departure time"),
  returnTime: optionalTime("The return time"),
  transportation: z.string().trim().min(1, "Enter how the children will get there, or who they ride with.").max(200, "Transportation can be 200 characters or fewer."),
  cost: optionalText(80),
  whatToBring: optionalText(600),
  note: optionalText(600),
}).strict().superRefine((details, context) => {
  if (details.endDate && details.endDate < details.startDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "The last date can't be before the first date." });
  }
});

export type OutingDetails = z.infer<typeof outingDetailsSchema>;

export const outingQuestionSchema = z.object({
  label: z.string().trim().min(1, "Enter the question.").max(120, "A question can be 120 characters or fewer."),
  type: z.enum(OUTING_QUESTION_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1, "A choice can't be empty.").max(60, "A choice can be 60 characters or fewer.")).max(8, "Offer 8 choices or fewer.").default([]),
}).strict();

export type OutingQuestion = z.infer<typeof outingQuestionSchema>;

export const outingInputSchema = z.object({
  details: outingDetailsSchema,
  questions: z.array(outingQuestionSchema).max(OUTING_MAX_QUESTIONS, `Ask ${OUTING_MAX_QUESTIONS} questions or fewer.`).default([]),
}).strict();

export type OutingInput = z.infer<typeof outingInputSchema>;

const questionKey = (index: number) => `outing_q_${index + 1}`;

/** The questions as slip fields: short text, yes/no (Yes and No) or a choice, asked once, never sensitive. */
export function outingQuestionFields(questions: readonly OutingQuestion[]): RegistrationFormField[] {
  return questions.map((question, index) => ({
    id: `f_${questionKey(index)}`,
    key: questionKey(index),
    label: question.label,
    helpText: "",
    type: question.type === "TEXT" ? "TEXT" : "RADIO",
    scope: "REGISTRATION",
    required: question.required,
    options: question.type === "YES_NO" ? ["Yes", "No"] : question.type === "CHOICE" ? [...question.options] : [],
  }));
}

/** Words that mean a medical, health or insurance detail, on top of the club registration form's own rule (#408). */
const OUTING_MEDICAL_PATTERN =
  /\b(?:allerg\w*|diet\w*|food|eat|eating|pills?|glasses|wheelchair|hospital\w*|nurse\w*|weight|adhd|autis\w*|anxi\w*|depress\w*|disorder\w*|(?:medical|physical|chronic|existing|pre-?existing|any)\s+conditions?|diagnos\w*|asthma\w*|inhaler\w*|epipen\w*|seizure\w*|epilep\w*|diabet\w*|injur\w*|surger\w*|prescri\w*|doctor\w*|physician\w*|immuni[sz]\w*|vaccin\w*|illness\w*|disease\w*|sick\w*|symptom\w*|therap\w*|treatment\w*|blood\s*type|mental)\b/i;
const OUTING_BIRTH_PATTERN = /\b(?:born|how\s+old|age)\b/i;

/** Why a question can't be asked, or null. The wording and every choice count; the type does not matter. */
export function outingQuestionProblem(question: Pick<OutingQuestion, "label" | "options">, key = "outing_question"): string | null {
  const texts = [question.label, ...question.options];
  for (const text of texts) {
    if (BIRTH_DATE_PATTERN.test(text) || OUTING_BIRTH_PATTERN.test(text)) {
      return "can't ask for a birth date or age. The roster already has it.";
    }
    if (looksLikeMedicalFreeText({ key, label: text }) || OUTING_MEDICAL_PATTERN.test(text)) {
      return "can't ask for medical, health or dietary details. Those belong in the slip's own medical and emergency section.";
    }
  }
  return null;
}

/**
 * Parses and checks an outing's details and questions. Throws VALIDATION_FAILED, naming the question by number
 * (`question:N`) and never echoing more than its own label, when a question is the wrong shape or asks for a birth
 * date or medical details. Returns the clean value.
 */
export function parseOutingInput(raw: unknown): OutingInput {
  const parsed = outingInputSchema.safeParse(raw);
  if (!parsed.success) {
    // Every problem, each tied to its own field or question, so the form can show them all beside their fields.
    const issues = parsed.error.issues.slice(0, 12).map((issue) => {
      const path = issue.path;
      const number = path[0] === "questions" && typeof path[1] === "number" ? path[1] + 1 : null;
      const message = `${number ? `Question ${number}: ` : ""}${issue.message}`;
      return { key: number ? `question:${number}` : String(path[1] ?? path[0] ?? "outing"), message };
    });
    throw new ClubFormError("VALIDATION_FAILED", issues[0]?.message ?? "Check the outing and try again.", issues);
  }
  const input = parsed.data;
  const issues = input.questions.flatMap((question, index) => {
    const number = index + 1;
    const found: Array<{ key: string; message: string }> = [];
    if (question.type === "CHOICE") {
      const unique = new Set(question.options.map((option) => option.toLowerCase()));
      if (question.options.length < 2) found.push({ key: `question:${number}`, message: `Question ${number}: offer at least 2 choices.` });
      else if (unique.size !== question.options.length) found.push({ key: `question:${number}`, message: `Question ${number}: each choice must be different.` });
    }
    const problem = outingQuestionProblem(question, questionKey(index));
    if (problem) found.push({ key: `question:${number}`, message: `Question ${number} ${problem}` });
    return found;
  });
  if (issues.length > 0) throw new ClubFormError("VALIDATION_FAILED", issues[0].message, issues);
  // Only a choice keeps its choices.
  return { ...input, questions: input.questions.map((question) => ({ ...question, options: question.type === "CHOICE" ? question.options : [] })) };
}

/** Reads a stored outing's JSON back; one that no longer parses reads as not usable. */
export function readStoredOuting(row: { details: unknown; questions: unknown }): OutingInput | null {
  const parsed = outingInputSchema.safeParse({ details: row.details, questions: row.questions });
  return parsed.success ? parsed.data : null;
}

/**
 * Adds the club's questions as their own section right after the permission section. Every other section is left
 * exactly as the template has it.
 */
export function withOutingQuestions(definition: RegistrationFormDefinition, questions: readonly OutingQuestion[], clubName = ""): RegistrationFormDefinition {
  if (questions.length === 0) return definition;
  const section = {
    id: OUTING_QUESTIONS_SECTION_ID,
    title: clubName ? `Questions from ${clubName}` : "Questions from the club",
    description: "",
    fields: outingQuestionFields(questions),
  };
  const at = definition.sections.findIndex((candidate) => candidate.id === OUTING_PERMISSION_SECTION_ID);
  const sections = [...definition.sections];
  sections.splice(at >= 0 ? at + 1 : sections.length, 0, section);
  return { ...definition, sections };
}

/**
 * What a parent fills in: the permission section keeps its place and its wording but its three typed fields are
 * gone (the outing's details stand in, read-only), and the club's questions follow it.
 */
export function definitionForOutingFill(definition: RegistrationFormDefinition, questions: readonly OutingQuestion[], clubName = ""): RegistrationFormDefinition {
  const sections = definition.sections.map((section) => (
    section.id === OUTING_PERMISSION_SECTION_ID
      ? { ...section, fields: section.fields.filter((field) => !PRESET_KEY_SET.has(field.key)) }
      : section
  ));
  return withOutingQuestions({ ...definition, sections }, questions, clubName);
}

/** The slip's three typed answers, set from the outing and never from the parent. */
export function outingPresetAnswers(details: Pick<OutingDetails, "activity" | "startDate" | "transportation">): Record<string, string> {
  return {
    [OUTING_PRESET_KEYS.activity]: details.activity,
    [OUTING_PRESET_KEYS.date]: details.startDate,
    [OUTING_PRESET_KEYS.rideWith]: details.transportation,
  };
}

/** "8:30 AM" from "08:30": a wall-clock time, so it is formatted in UTC from a fixed instant and never shifted. */
export function outingTimeLabel(value: string) {
  if (!TIME_PATTERN.test(value)) return "";
  const [hour, minute] = value.split(":").map(Number);
  return formatInTimeZone(new Date(Date.UTC(2000, 0, 1, hour, minute)), "UTC", { hour: "numeric", minute: "2-digit", zoneLabel: false });
}

export function outingDateLabel(details: Pick<OutingDetails, "startDate" | "endDate">) {
  return formatDateRange(details.startDate, details.endDate || details.startDate);
}

export type OutingDetailRow = { label: string; value: string };

/** The slip's own labels for its three typed fields, read from the template's definition (never written here). */
export function outingPresetLabels(definition: RegistrationFormDefinition | null): Partial<Record<keyof typeof OUTING_PRESET_KEYS, string>> {
  const labels = new Map((definition?.sections ?? []).flatMap((section) => section.fields.map((field) => [field.key, field.label] as const)));
  // The template's own wording; a plain default only when the template has no such field (or no readable definition).
  const pick = (key: string, fallback: string) => labels.get(key) ?? fallback;
  return {
    activity: pick(OUTING_PRESET_KEYS.activity, "Activity"),
    date: pick(OUTING_PRESET_KEYS.date, "Date"),
    rideWith: pick(OUTING_PRESET_KEYS.rideWith, "Transportation and who your child rides with"),
  };
}

/**
 * The details as read-only label and value rows, for the parent's page, the director's pages and the print view. The
 * three the slip already asks use the template's own labels (a plain default label if the template has no such field);
 * the extra rows (times, cost, what to bring, the note) have their own. Empty ones are left out.
 */
export function outingDetailRows(details: OutingDetails, definition: RegistrationFormDefinition | null): OutingDetailRow[] {
  const labels = outingPresetLabels(definition);
  const rows: Array<{ label: string | undefined; value: string }> = [
    { label: labels.activity, value: details.activity },
    { label: labels.date, value: outingDateLabel(details) },
    { label: "Leaving", value: outingTimeLabel(details.departureTime) },
    { label: "Back", value: outingTimeLabel(details.returnTime) },
    { label: labels.rideWith, value: details.transportation },
    { label: "Cost", value: details.cost },
    { label: "What to bring", value: details.whatToBring },
    { label: "Note from the club", value: details.note },
  ];
  return rows.flatMap((row) => (row.label && row.value !== "" ? [{ label: row.label, value: row.value }] : []));
}

export type OutingLinkState = "SIGNED" | "NOT_YET" | "EXPIRED";

/** One tracking row's word: signed, not yet, or link expired (a withdrawn or undelivered link counts as expired). */
export function outingLinkState(link: { status: "OPEN" | "USED" | "REVOKED"; expiresAt: Date }, now: Date): OutingLinkState {
  if (link.status === "USED") return "SIGNED";
  if (link.status === "REVOKED" || link.expiresAt <= now) return "EXPIRED";
  return "NOT_YET";
}

export const outingLinkStateLabel: Record<OutingLinkState, string> = { SIGNED: "Signed", NOT_YET: "Not yet", EXPIRED: "Link expired" };

export type OutingSendOutcome = "SENT" | "ALREADY_SIGNED" | "ALREADY_SENT" | "NO_PARENT_EMAIL" | "NOT_ELIGIBLE" | "RATE_LIMITED" | "CLUB_LIMIT" | "NOT_FOUND" | "FAILED";

export const outingSendOutcomeText: Record<OutingSendOutcome, string> = {
  SENT: "Sent",
  ALREADY_SIGNED: "Already signed",
  ALREADY_SENT: "Already sent: use Resend to send again",
  NO_PARENT_EMAIL: "No parent email on the roster",
  NOT_ELIGIBLE: "Not a youth member",
  RATE_LIMITED: "This parent's address was sent this outing's slip 3 times in the last hour, or 12 slips in all: try again later",
  CLUB_LIMIT: `Your club's daily limit of ${OUTING_SLIPS_PER_DAY} slips is used up: try again tomorrow`,
  NOT_FOUND: "Not on the roster",
  FAILED: "Could not be sent",
};
