import { z } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { closeoutActor, closeoutApiError, closeoutHeaders } from "@/modules/events/closeout-api";
import { clearClosedMoneyFlag, ClosedMoneyFlagError } from "@/modules/events/closed-event-money-flags";
import { CLOSED_MONEY_CLEAR_NOTE_MAX_LENGTH } from "@/modules/events/closeout-domain";
import { closeoutSignoffPermissions } from "@/modules/events/lifecycle-state";
import { withRequestContext } from "@/lib/request-context";

const bodySchema = z.strictObject({
  flagId: z.string().trim().min(1).max(64),
  /** What the reviewer checked. Required. */
  note: z.string().trim().min(1).max(CLOSED_MONEY_CLEAR_NOTE_MAX_LENGTH),
});

const status = { FLAG_NOT_FOUND: 404, ALREADY_CLEARED: 409, NOTE_REQUIRED: 400, NOTE_TOO_LONG: 400, ACTOR_NOT_FOUND: 404 } as const;

/**
 * Marks money Square recorded while the event was Closed as reviewed (#1515 follow-up). MANAGE_FINANCE or FINALIZE_INVOICES,
 * in any lifecycle state. Changes no payment and no refund; the flag is kept, with who cleared it and the note.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await closeoutActor(eventId);
    if (!closeoutSignoffPermissions.some((permission) => actor.permissions.includes(permission))) {
      throw new AccessDeniedError("Only a finance admin (finance or finalize-invoices permission) can mark this money reviewed.", 403, "PERMISSION_DENIED");
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "INVALID_REQUEST", message: `Send a flagId and a note of 1 to ${CLOSED_MONEY_CLEAR_NOTE_MAX_LENGTH} characters.` }, { status: 400, headers: closeoutHeaders });
    }
    const result = await clearClosedMoneyFlag({ eventId, flagId: parsed.data.flagId, actorUserId: actor.userId, note: parsed.data.note });
    return Response.json({ reviewed: true, flagId: result.id }, { headers: closeoutHeaders });
  } catch (error) {
    if (error instanceof ClosedMoneyFlagError) {
      return Response.json({ error: `CLOSED_MONEY_${error.code}`, message: error.message }, { status: status[error.code], headers: closeoutHeaders });
    }
    return closeoutApiError(error);
  }
}

export const POST = withRequestContext(postHandler);
