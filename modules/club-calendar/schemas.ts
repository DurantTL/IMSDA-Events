import { z } from "zod";
import {
  CLUB_CALENDAR_KINDS,
  CLUB_CALENDAR_LOCATION_MAX,
  CLUB_CALENDAR_NOTES_MAX,
  CLUB_CALENDAR_TITLE_MAX,
  REMINDER_DAYS_MAX,
  REMINDER_DAYS_MIN,
  isClubCalendarDate,
  isClubCalendarTime,
  timeRangeProblem,
} from "@/modules/club-calendar/domain";

const noControl = (label: string) => (value: string) => !/[\u0000-\u001f\u007f]/.test(value) || `${label} can't hold line breaks.`;

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const optionalLine = (label: string, max: number) => z.preprocess(
  emptyToUndefined,
  z.string().trim().max(max, `${label} can be at most ${max} characters.`).refine((value) => noControl(label)(value) === true, `${label} can't hold line breaks.`).optional(),
);

const optionalTime = (label: string) => z.preprocess(
  emptyToUndefined,
  z.string().trim().refine(isClubCalendarTime, `Enter ${label} as a time, like 18:30.`).optional(),
);

/** Notes may have line breaks, but no other control characters. */
const optionalNotes = z.preprocess(
  emptyToUndefined,
  z.string().trim().max(CLUB_CALENDAR_NOTES_MAX, `Notes can be at most ${CLUB_CALENDAR_NOTES_MAX} characters.`).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Notes can't hold control characters.").optional(),
);

export const clubCalendarItemSchema = z.object({
  kind: z.enum(CLUB_CALENDAR_KINDS, { error: "Choose Meeting, Outing or Deadline." }),
  title: z.string().trim()
    .min(1, "Enter a title.")
    .max(CLUB_CALENDAR_TITLE_MAX, `The title can be at most ${CLUB_CALENDAR_TITLE_MAX} characters.`)
    .refine((value) => noControl("The title")(value) === true, "The title can't hold line breaks."),
  date: z.string().trim().refine(isClubCalendarDate, "Enter a date."),
  startTime: optionalTime("the start time"),
  endTime: optionalTime("the end time"),
  location: optionalLine("The location", CLUB_CALENDAR_LOCATION_MAX),
  notes: optionalNotes,
}).strict().superRefine((value, ctx) => {
  const problem = timeRangeProblem(value.startTime ?? null, value.endTime ?? null);
  if (problem) ctx.addIssue({ code: "custom", path: [value.endTime && !value.startTime ? "startTime" : "endTime"], message: problem });
});

export type ClubCalendarItemInput = z.infer<typeof clubCalendarItemSchema>;

export const clubCalendarReminderSettingSchema = z.object({
  enabled: z.boolean({ error: "Choose on or off." }),
  daysBefore: z.number({ error: "Enter a number of days." })
    .int("Enter a whole number of days.")
    .min(REMINDER_DAYS_MIN, `Reminders go out ${REMINDER_DAYS_MIN} to ${REMINDER_DAYS_MAX} days before.`)
    .max(REMINDER_DAYS_MAX, `Reminders go out ${REMINDER_DAYS_MIN} to ${REMINDER_DAYS_MAX} days before.`),
}).strict();

export type ClubCalendarReminderSettingInput = z.infer<typeof clubCalendarReminderSettingSchema>;

/** The month in `?month=YYYY-MM`, or undefined: the page falls back to the current conference month. */
export function parseMonthQuery(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(single) ? single : undefined;
}
