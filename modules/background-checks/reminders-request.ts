import { z } from "zod";
import { REMINDER_FILTERS, REMINDER_MAX_PEOPLE } from "@/modules/background-checks/reminders-domain";

/** Who a reminder is about: chosen roster members, or everyone in one filter. Checked again on the server either way. */
export const reminderSelectionSchema = z.union([
  z.object({ rosterMemberIds: z.array(z.string().min(1).max(64)).min(1, "Choose at least one person.").max(REMINDER_MAX_PEOPLE, `Choose at most ${REMINDER_MAX_PEOPLE} people for one reminder.`) }).strict(),
  z.object({ filter: z.enum(REMINDER_FILTERS), all: z.literal(true) }).strict(),
]);

export const previewReminderBodySchema = z.object({ selection: reminderSelectionSchema }).strict();

export const sendReminderBodySchema = z.object({
  selection: reminderSelectionSchema,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "Open the preview before sending."),
  confirmRecent: z.boolean().optional(),
}).strict();
