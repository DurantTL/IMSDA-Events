import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { baptismApiError, jsonNoStore } from "@/modules/baptism-follow-up/api-errors";
import { leadEmailsInputSchema } from "@/modules/baptism-follow-up/domain";
import { saveBaptismLeadEmails } from "@/modules/baptism-follow-up/settings";
import { requireAreaCoordinatorToggleActor } from "@/modules/event-modules/scoped-toggle";

/** An Area Coordinator sets who is emailed about baptism follow-up for a published club event (#1680). Audited with the counts and the lead addresses, never a name. */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorToggleActor();
    const { eventId } = await context.params;
    const input = leadEmailsInputSchema.parse(await request.json());
    const saved = await saveBaptismLeadEmails(actor, eventId, input.leadEmails);
    return jsonNoStore({ leadEmails: saved.leadEmails });
  } catch (error) {
    return baptismApiError(error, { log: "Saving the baptism follow-up addresses failed", message: "The addresses could not be saved." });
  }
}

export const PUT = withRequestContext(putHandler);
