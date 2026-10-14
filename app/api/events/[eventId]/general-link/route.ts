import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { generalLinkApiError } from "@/modules/general-link-registrations/api-errors";
import { getGeneralLinkSettings, setGeneralRegistrationLink } from "@/modules/general-link-registrations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "no-store" };

/** The event's general registration link setting (#931), for event administrators (CONFIGURE_EVENT). */
async function getHandler(_request: Request, context: Context) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    return Response.json({ settings: await getGeneralLinkSettings(eventId) }, { headers: noStore });
  } catch (error) {
    return generalLinkApiError(error, "Loading the general registration link");
  }
}

/** Turns the link on or off. Audited. */
async function putHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(await request.json());
    return Response.json({ settings: await setGeneralRegistrationLink(eventId, enabled, access.user.id) }, { headers: noStore });
  } catch (error) {
    return generalLinkApiError(error, "Saving the general registration link");
  }
}

export const GET = withRequestContext(getHandler);
export const PUT = withRequestContext(putHandler);
