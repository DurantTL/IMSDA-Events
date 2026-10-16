import { z } from "zod";
import { SeatOverrideError } from "@/modules/honors/admin-placement";
import { seatOverrideReasonMax, seatOverrideReasonMin } from "@/modules/honors/admin-placement-limits";
import { honorApiError } from "@/modules/honors/api-errors";

const reasonSchema = z.string().trim()
  .min(seatOverrideReasonMin, `Give a reason of at least ${seatOverrideReasonMin} characters.`)
  .max(seatOverrideReasonMax);

export const placeYouthSchema = z.object({
  registrationAttendeeId: z.string().trim().min(1).max(100),
  offeringId: z.string().trim().min(1).max(100),
  reason: reasonSchema,
  // A level or prerequisite waiver, recorded like the staff override on a pick save (#832).
  overrideReason: z.string().trim().min(3, "Give a reason for placing someone who doesn't meet a class requirement.").max(seatOverrideReasonMax).optional(),
  confirmed: z.boolean().optional(),
}).strict();

export const removePickSchema = z.object({ reason: reasonSchema }).strict();

const statusByCode: Record<SeatOverrideError["code"], number> = {
  NOT_AUTHORIZED: 403,
  ATTENDEE_NOT_FOUND: 404,
  OFFERING_NOT_FOUND: 404,
  PICK_NOT_FOUND: 404,
  NOT_REGISTERED: 409,
  SELECTION_INVALID: 422,
  ALREADY_IN_CLASS: 409,
  CLASS_HAS_SEAT: 409,
  HAS_LIVE_OFFER: 409,
  PICK_HAS_MARKS: 409,
  SELECTION_CONFLICT: 409,
};

export function seatOverrideApiError(error: unknown, action: string) {
  if (error instanceof SeatOverrideError) {
    return Response.json({ error: error.code, message: error.message }, { status: statusByCode[error.code] });
  }
  return honorApiError(error, action);
}
