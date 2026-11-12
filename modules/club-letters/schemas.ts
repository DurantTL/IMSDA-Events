import { z } from "zod";
import { CLUB_LETTER_KINDS, LETTER_BODY_MAX, LETTER_TITLE_MAX, placeholderProblem } from "@/modules/club-letters/domain";

const title = z.string().trim()
  .min(1, "Enter a title.")
  .max(LETTER_TITLE_MAX, `The title can be at most ${LETTER_TITLE_MAX} characters.`)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "The title can't hold line breaks.");

// Line breaks are the point of a letter; only other control characters are refused. The body is not trimmed.
const body = z.string()
  .refine((value) => value.trim().length > 0, "Enter the text of the letter.")
  .max(LETTER_BODY_MAX, `The text can be at most ${LETTER_BODY_MAX.toLocaleString("en-US")} characters.`)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "The text can't hold control characters.")
  .superRefine((value, ctx) => {
    const problem = placeholderProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const kind = z.enum(CLUB_LETTER_KINDS, { error: "Choose Letter or Certificate." });

export const clubLetterCreateSchema = z.object({ kind, title, body }).strict();
export const clubLetterUpdateSchema = z.object({ kind, title, body }).strict();

export type ClubLetterInput = z.infer<typeof clubLetterCreateSchema>;

export const parseClubLetterCreate = (value: unknown): ClubLetterInput => clubLetterCreateSchema.parse(value);
export const parseClubLetterUpdate = (value: unknown): ClubLetterInput => clubLetterUpdateSchema.parse(value);
