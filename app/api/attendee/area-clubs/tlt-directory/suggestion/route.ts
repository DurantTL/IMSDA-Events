import { withRequestContext } from "@/lib/request-context";
import { suggestionAcceptSchema } from "@/modules/tlt-directory/domain";
import { tltApiError, tltDirectorRequest } from "@/modules/tlt-directory/api";
import { acceptTltTagSuggestion } from "@/modules/tlt-directory/repository";

/** Accepts one suggested help-area tag for one TLT (#1686). TLT director only; the server re-checks the tag is suggested. */
async function postHandler(request: Request) {
  const gate = await tltDirectorRequest(request);
  if ("response" in gate) return gate.response;
  try {
    await acceptTltTagSuggestion(suggestionAcceptSchema.parse(gate.body), gate.actor);
    return Response.json({ message: "Saved." }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return tltApiError(error, "Accepting a suggested tag");
  }
}

export const POST = withRequestContext(postHandler);
