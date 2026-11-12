import { withRequestContext } from "@/lib/request-context";
import { listActionSchema } from "@/modules/tlt-directory/domain";
import { tltApiError, tltDirectorRequest } from "@/modules/tlt-directory/api";
import { changeTltList } from "@/modules/tlt-directory/repository";

/** Adds, renames, retires or restores a TLT position type or help-area tag (#1686). Nothing is deleted. TLT director only. */
async function postHandler(request: Request) {
  const gate = await tltDirectorRequest(request);
  if ("response" in gate) return gate.response;
  try {
    const result = await changeTltList(listActionSchema.parse(gate.body), gate.actor);
    return Response.json({ message: "Saved.", id: result.id }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return tltApiError(error, "Changing a TLT list");
  }
}

export const POST = withRequestContext(postHandler);
