import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubLeaderViewer } from "@/modules/club-forms/access";
import { clubFormApiError, readClubFormJson } from "@/modules/club-forms/api-errors";
import { createOuting } from "@/modules/club-forms/outings";

type RouteContext = { params: Promise<{ organizationId: string }> };

/** A director or deputy creates an outing permission slip (#1672): the details and up to five club questions. */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const viewer = await requireClubLeaderViewer(organizationId);
    const { outingId } = await createOuting(viewer, organizationId, await readClubFormJson(request));
    return Response.json({ outing: { id: outingId } }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return clubFormApiError(error, "Creating an outing permission slip");
  }
}

export const POST = withRequestContext(postHandler);
