import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubFormApiError, readClubFormJson } from "@/modules/club-forms/api-errors";
import { discardPublicClubFormsDraft, getPublicClubFormsAdminState, savePublicClubFormsDraft } from "@/modules/club-forms/public-index-settings";
import { requireClubsAdministration } from "@/modules/organizations/access";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

/** The public Club forms page's working draft (#1562). System administrators and Clubs Administrators only; every call checks again. */
async function getHandler(request: Request) {
  void request; // a read takes no input; the signature is what the request wrapper expects
  try {
    await requireClubsAdministration();
    return Response.json(await getPublicClubFormsAdminState(), { headers: noStore });
  } catch (error) {
    return clubFormApiError(error, "Reading the public club forms settings");
  }
}

async function putHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await requireClubsAdministration();
    return Response.json(await savePublicClubFormsDraft(await readClubFormJson(request), admin.id), { headers: noStore });
  } catch (error) {
    return clubFormApiError(error, "Saving the public club forms draft");
  }
}

async function deleteHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await requireClubsAdministration();
    await discardPublicClubFormsDraft(admin.id);
    return Response.json({ discarded: true }, { headers: noStore });
  } catch (error) {
    return clubFormApiError(error, "Discarding the public club forms draft");
  }
}

export const GET = withRequestContext(getHandler);
export const PUT = withRequestContext(putHandler);
export const DELETE = withRequestContext(deleteHandler);
