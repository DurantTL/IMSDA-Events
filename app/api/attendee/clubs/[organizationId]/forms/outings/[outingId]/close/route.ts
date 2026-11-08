import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubLeaderViewer } from "@/modules/club-forms/access";
import { clubFormApiError } from "@/modules/club-forms/api-errors";
import { closeOuting } from "@/modules/club-forms/outings";

type RouteContext = { params: Promise<{ organizationId: string; outingId: string }> };

/** Closes an outing (#1672): its open links stop working and nothing more can be sent. */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, outingId } = await context.params;
    const viewer = await requireClubLeaderViewer(organizationId);
    const { closedLinks } = await closeOuting(viewer, organizationId, outingId);
    return Response.json({ ok: true, closedLinks }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return clubFormApiError(error, "Closing an outing permission slip");
  }
}

export const POST = withRequestContext(postHandler);
