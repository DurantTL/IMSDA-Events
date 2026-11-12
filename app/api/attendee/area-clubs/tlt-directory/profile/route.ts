import { withRequestContext } from "@/lib/request-context";
import { profileUpdateSchema } from "@/modules/tlt-directory/domain";
import { tltApiError, tltDirectorRequest } from "@/modules/tlt-directory/api";
import { updateTltProfile } from "@/modules/tlt-directory/repository";

/** Saves one TLT's year, position type, status and help-area tags (#1686). TLT director only; any other key is a 400. */
async function postHandler(request: Request) {
  const gate = await tltDirectorRequest(request);
  if ("response" in gate) return gate.response;
  try {
    await updateTltProfile(profileUpdateSchema.parse(gate.body), gate.actor);
    return Response.json({ message: "Saved." }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return tltApiError(error, "Saving a TLT record");
  }
}

export const POST = withRequestContext(postHandler);
