import { z } from "zod";
import { PAPER_LOCATION_HELP, PAPER_LOCATION_MAX, normalizePaperLocation } from "@/modules/acknowledgments/domain";

/** Where a paper form lives: trimmed, never what it says. Required for PAPER and refused for every other channel. */
const paperLocationField = z.string().trim().max(PAPER_LOCATION_MAX, PAPER_LOCATION_HELP).nullish();

function checkPaperLocation(value: { channel: "STAFF_ENTERED" | "PAPER"; paperLocation?: string | null }, context: z.RefinementCtx) {
  const result = normalizePaperLocation(value.channel, value.paperLocation);
  if (!result.ok) context.addIssue({ code: "custom", path: ["paperLocation"], message: result.message });
}

/**
 * Staff record an acknowledgment given on screen or on paper (#150). The wording is never part of the request: it is
 * read from the registration's own form version, so staff cannot record text the person was not shown.
 */
export const staffAcknowledgmentSchema = z.object({
  /** Agree (the default) or decline: the person was shown the wording and said no. Staff-recorded only. */
  action: z.enum(["ACKNOWLEDGE", "DECLINE"]).default("ACKNOWLEDGE"),
  fieldKey: z.string().trim().min(2).max(60),
  /** The attendee, for an attendee-level acknowledgment. */
  attendeeId: z.string().trim().min(1).max(100).nullish(),
  /** Who acknowledged: the attendee themselves (default) or, for a minor, their declared responsible adult. */
  actedByPersonId: z.string().trim().min(1).max(100).nullish(),
  channel: z.enum(["STAFF_ENTERED", "PAPER"]),
  /** Where the paper form physically lives; required for PAPER, refused otherwise. Never its contents. */
  paperLocation: paperLocationField,
  /** When it was given (a paper form's date). Defaults to now; cannot be in the future. */
  acknowledgedAt: z.iso.datetime().nullish(),
  /** Sent again unchanged on a retry, so a retry returns the first result instead of recording twice. */
  clientRequestId: z.uuid(),
}).strict().superRefine(checkPaperLocation);

export type StaffAcknowledgmentRequest = z.infer<typeof staffAcknowledgmentSchema>;

/** Staff void an acknowledgment with a reason (#150). The evidence id is in the URL; the reason is kept on the void row only. */
export const voidAcknowledgmentSchema = z.object({
  reason: z.string().trim().min(1, "Enter a reason for voiding this acknowledgment.").max(1000),
}).strict();

/**
 * Staff record that a person withdrew an earlier acceptance (#130). The acceptance is in the URL and is never changed; the
 * withdrawal is a new record. `withdrawnAt` defaults to now and may not be in the future or before the acceptance.
 */
export const withdrawAcknowledgmentSchema = z.object({
  channel: z.enum(["STAFF_ENTERED", "PAPER"]),
  /** Who withdrew: the subject (default) or, for a minor, their declared responsible adult. */
  actedByPersonId: z.string().trim().min(1).max(100).nullish(),
  withdrawnAt: z.iso.datetime().nullish(),
  paperLocation: paperLocationField,
  clientRequestId: z.uuid(),
}).strict().superRefine(checkPaperLocation);

export const acknowledgmentStatusQuerySchema = z.object({
  at: z.iso.datetime().optional(),
});
