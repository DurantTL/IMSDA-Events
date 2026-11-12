import { z } from "zod";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { AccessDeniedError } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { leadEmailsInputSchema } from "@/modules/baptism-follow-up/domain";
import { BaptismFollowUpError, requireBaptismFollowUpStaff, saveBaptismLeadEmails } from "@/modules/baptism-follow-up/settings";
import { findActiveMembership } from "@/modules/events/repository";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * Staff set who is emailed about baptism follow-up for an event (#1680): a system administrator, an Event Admin of the event or
 * the Clubs Administrator. Checked on the server; the page only decides what to show. Audited with counts, never an address.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireBaptismFollowUpStaff(await getCurrentSession(), eventId, findActiveMembership);
    const input = leadEmailsInputSchema.parse(await request.json());
    const saved = await saveBaptismLeadEmails(actor, eventId, input.leadEmails);
    return Response.json({ leadEmails: saved.leadEmails }, { headers: noStore });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "INVALID_REQUEST", message: "Review what you entered." }, { status: 400, headers: noStore });
    if (error instanceof SyntaxError) return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400, headers: noStore });
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
    if (error instanceof BaptismFollowUpError) {
      const status = error.code === "EVENT_NOT_FOUND" ? 404 : 422;
      return Response.json({ error: error.code, message: error.message }, { status, headers: noStore });
    }
    logError("Saving the baptism follow-up addresses failed", error);
    return Response.json({ error: "BAPTISM_FOLLOW_UP_FAILED", message: "The addresses could not be saved." }, { status: 500, headers: noStore });
  }
}

export const PUT = withRequestContext(putHandler);
