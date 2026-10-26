import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubFormApiError, readClubFormJson } from "@/modules/club-forms/api-errors";
import { setOpenApplicationClosed } from "@/modules/club-forms/open-applications";
import { openLinkClosedSchema } from "@/modules/club-forms/schemas";
import { requireSystemAdministrator } from "@/modules/organizations/access";

type RouteContext = { params: Promise<{ templateKey: string }> };

/** A system administrator closes or reopens an open application for the current club year (#1229). Nobody else can. */
async function putHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await requireSystemAdministrator();
    const { templateKey } = await context.params;
    const { closed } = openLinkClosedSchema.parse(await readClubFormJson(request));
    return Response.json(await setOpenApplicationClosed(templateKey, closed, admin.id), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return clubFormApiError(error, "Closing a club form application");
  }
}

export const PUT = withRequestContext(putHandler);
