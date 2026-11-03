import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubFormApiError } from "@/modules/club-forms/api-errors";
import { publishPublicClubFormsDraft } from "@/modules/club-forms/public-index-settings";
import { requireClubsAdministration } from "@/modules/organizations/access";

/** Publishes the public Club forms page draft (#1562). System administrators and Clubs Administrators only. */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await requireClubsAdministration();
    return Response.json(await publishPublicClubFormsDraft(admin.id), { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return clubFormApiError(error, "Publishing the public club forms page");
  }
}

export const POST = withRequestContext(postHandler);
