import { withRequestContext } from "@/lib/request-context";
import { moveUpResultMessage, moveUpSchema } from "@/modules/tlt-directory/domain";
import { tltApiError, tltDirectorRequest } from "@/modules/tlt-directory/api";
import { confirmTltMoveUp } from "@/modules/tlt-directory/repository";

/**
 * Confirms the club-year TLT move-up (#1686). TLT director only. The server recomputes who is still eligible, so the
 * body only says whom she left ticked; a stale club year is a 409. Returns how many moved, were kept and were skipped.
 */
async function postHandler(request: Request) {
  const gate = await tltDirectorRequest(request);
  if ("response" in gate) return gate.response;
  try {
    const result = await confirmTltMoveUp(moveUpSchema.parse(gate.body), gate.actor);
    return Response.json({ ...result, message: moveUpResultMessage(result.moved, result.skipped, result.kept) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return tltApiError(error, "Moving TLTs up a year");
  }
}

export const POST = withRequestContext(postHandler);
