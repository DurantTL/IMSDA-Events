import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubFormApiError, readClubFormJson } from "@/modules/club-forms/api-errors";
import { templateFillModeSchema } from "@/modules/club-forms/schemas";
import { setClubFormTemplateFillMode } from "@/modules/club-forms/templates";
import { requireClubsAdministration } from "@/modules/organizations/access";

type RouteContext = { params: Promise<{ templateKey: string }> };

/** A system administrator or Clubs Administrator (#1225) sets who fills a club form in (#1229). Nobody else can. */
async function putHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await requireClubsAdministration();
    const { templateKey } = await context.params;
    const { fillMode } = templateFillModeSchema.parse(await readClubFormJson(request));
    return Response.json(await setClubFormTemplateFillMode(templateKey, fillMode, admin.id), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return clubFormApiError(error, "Changing who fills in a club form");
  }
}

export const PUT = withRequestContext(putHandler);
