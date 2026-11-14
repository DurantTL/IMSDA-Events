import { withRequestContext } from "@/lib/request-context";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { baptismApiError, jsonNoStore } from "@/modules/baptism-follow-up/api-errors";
import { leadEmailsInputSchema } from "@/modules/baptism-follow-up/domain";
import { requireBaptismFollowUpStaff, saveBaptismLeadEmails } from "@/modules/baptism-follow-up/settings";
import { findActiveMembership } from "@/modules/events/repository";

/**
 * Staff set who is emailed about baptism follow-up for an event (#1680): a system administrator, an Event Admin of the event or
 * the Clubs Administrator. Checked on the server; the page only decides what to show. Audited with the counts and the lead addresses added and removed, never an attendee name.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireBaptismFollowUpStaff(await getCurrentSession(), eventId, findActiveMembership);
    const input = leadEmailsInputSchema.parse(await request.json());
    const saved = await saveBaptismLeadEmails(actor, eventId, input.leadEmails);
    return jsonNoStore({ leadEmails: saved.leadEmails });
  } catch (error) {
    return baptismApiError(error, { log: "Saving the baptism follow-up addresses failed", message: "The addresses could not be saved." });
  }
}

export const PUT = withRequestContext(putHandler);
