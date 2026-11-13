import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { closeoutActor, closeoutApiError, closeoutHeaders } from "@/modules/events/closeout-api";
import { CLOSEOUT_NOTE_MAX_LENGTH } from "@/modules/events/closeout-domain";
import { signOffEvent } from "@/modules/events/closeout-repository";
import { withRequestContext } from "@/lib/request-context";

const bodySchema = z.strictObject({
  /** The signer ticked the box saying the open warnings were reviewed. */
  acknowledgeWarnings: z.boolean(),
  note: z.string().max(CLOSEOUT_NOTE_MAX_LENGTH).nullish(),
  /** The event's lifecycle version on the page the signer reviewed; a changed event is refused (409). */
  lifecycleVersion: z.number().int().min(0),
});

/**
 * Signs the event off and closes it (#1515): Financial reconciliation to Closed, by any finance admin (MANAGE_FINANCE or
 * FINALIZE_INVOICES), recorded by name with a checklist snapshot. The checklist is read again on the server; blocking
 * checks refuse, and open warnings must be acknowledged in the request.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await closeoutActor(eventId);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "INVALID_REQUEST", message: `Send acknowledgeWarnings, lifecycleVersion and an optional note of at most ${CLOSEOUT_NOTE_MAX_LENGTH} characters.` }, { status: 400, headers: closeoutHeaders });
    }
    const result = await signOffEvent({ eventId, actor, acknowledgeWarnings: parsed.data.acknowledgeWarnings, note: parsed.data.note, expectedVersion: parsed.data.lifecycleVersion });
    return Response.json({ signedOff: true, signoffId: result.signoffId, lifecycleVersion: result.lifecycleVersion }, { headers: closeoutHeaders });
  } catch (error) { return closeoutApiError(error); }
}

export const POST = withRequestContext(postHandler);
