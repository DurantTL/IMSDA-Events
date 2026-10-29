import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubLeaderViewer } from "@/modules/club-forms/access";
import { clubFormApiError } from "@/modules/club-forms/api-errors";
import { startClubFormsYear } from "@/modules/club-forms/year-start";

type RouteContext = { params: Promise<{ organizationId: string }> };

/** A director or deputy starts the new club year: earlier years' forms move under Past years (#1323). Nothing is deleted. */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const viewer = await requireClubLeaderViewer(organizationId);
    const result = await startClubFormsYear(viewer, organizationId);
    return Response.json({ ok: true, clubYear: result.clubYear }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return clubFormApiError(error, "Starting the new club forms year");
  }
}

export const POST = withRequestContext(postHandler);
