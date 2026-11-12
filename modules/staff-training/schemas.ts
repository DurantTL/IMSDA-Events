import { z } from "zod";
import {
  NAD_CERTIFICATION_KEYS,
  SIGNED_OFF_BY_MAX,
  WORKSHOP_CODE_MAX,
  WORKSHOP_TITLE_MAX,
  completedOnProblem,
} from "@/modules/staff-training/domain";

/** One line of plain text: no control characters, trimmed. */
const line = (label: string, max: number) => z.string().trim()
  .min(1, `Enter ${label}.`)
  .max(max, `${label[0]!.toUpperCase()}${label.slice(1)} can be at most ${max} characters.`)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), `${label[0]!.toUpperCase()}${label.slice(1)} can't hold line breaks.`);

const optionalLine = (label: string, max: number) => z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  line(label, max).optional(),
);

const base = {
  personId: z.string().trim().min(1, "Choose a person.").max(64),
  completedOn: z.string().trim(),
  signedOffBy: optionalLine("the name of who signed off", SIGNED_OFF_BY_MAX),
};

const certification = z.object({
  ...base,
  kind: z.literal("CERTIFICATION"),
  certificationKey: z.enum(NAD_CERTIFICATION_KEYS, { error: "Choose a certification." }),
}).strict();

const workshop = z.object({
  ...base,
  kind: z.literal("WORKSHOP"),
  workshopCode: line("a workshop code", WORKSHOP_CODE_MAX).refine((value) => /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(value), "A workshop code uses letters, numbers, spaces and . _ / - only."),
  workshopTitle: line("a workshop title", WORKSHOP_TITLE_MAX),
}).strict();

/** An add: the kind decides which fields are required. The date is checked against the clock by `parseAddInput`. */
export const staffTrainingAddSchema = z.discriminatedUnion("kind", [certification, workshop], { error: "Choose Certification or Workshop." });

export type StaffTrainingAddInput = z.infer<typeof staffTrainingAddSchema>;

/** Parses an add request body and checks its date against `now`. Throws a ZodError whose first message is shown. */
export function parseStaffTrainingAdd(body: unknown, now: Date): StaffTrainingAddInput {
  const input = staffTrainingAddSchema.parse(body);
  const problem = completedOnProblem(input.completedOn, now);
  if (problem) {
    throw new z.ZodError([{ code: "custom", path: ["completedOn"], message: problem }]);
  }
  return input;
}
