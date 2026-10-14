import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { consentPolicyApiError } from "@/modules/consent/api-errors";
import { listPublishedPolicyVersionsForEvent } from "@/modules/consent/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/** Slim read for form builders: published versions only, with no body text, for the event's own and
 * organization-scoped policies. The full policy routes stay behind CONFIGURE_EVENT. */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FORMS", findActiveMembership);
    return Response.json({ versions: await listPublishedPolicyVersionsForEvent(eventId) });
  } catch (error) { return consentPolicyApiError(error); }
}

export const GET = withRequestContext(getHandler);
