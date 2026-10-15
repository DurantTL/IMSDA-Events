import { z } from "zod";

/**
 * Staff record an acknowledgment given on screen or on paper (#150). The wording is never part of the request: it is
 * read from the registration's own form version, so staff cannot record text the person was not shown.
 */
export const staffAcknowledgmentSchema = z.object({
  fieldKey: z.string().trim().min(2).max(60),
  /** The attendee, for an attendee-level acknowledgment. */
  attendeeId: z.string().trim().min(1).max(100).nullish(),
  /** Who acknowledged: the attendee themselves (default) or, for a minor, their declared responsible adult. */
  actedByPersonId: z.string().trim().min(1).max(100).nullish(),
  channel: z.enum(["STAFF_ENTERED", "PAPER"]),
  /** When it was given (a paper form's date). Defaults to now; cannot be in the future. */
  acknowledgedAt: z.iso.datetime().nullish(),
  /** Sent again unchanged on a retry, so a retry returns the first result instead of recording twice. */
  clientRequestId: z.uuid(),
}).strict();

export type StaffAcknowledgmentRequest = z.infer<typeof staffAcknowledgmentSchema>;

export const acknowledgmentStatusQuerySchema = z.object({
  at: z.iso.datetime().optional(),
});
