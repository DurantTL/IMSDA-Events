import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubLeaderViewer } from "@/modules/club-forms/access";
import { clubFormApiError } from "@/modules/club-forms/api-errors";
import { deleteUnusedClubFormLink } from "@/modules/club-forms/links";

type RouteContext = { params: Promise<{ organizationId: string; linkId: string }> };

/** A director or deputy deletes a private link of their own club that has no filled form (#1323). Withdrawing stays on DELETE of the link. */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, linkId } = await context.params;
    const viewer = await requireClubLeaderViewer(organizationId);
    await deleteUnusedClubFormLink(viewer, organizationId, linkId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return clubFormApiError(error, "Deleting a club form link");
  }
}

export const POST = withRequestContext(postHandler);
