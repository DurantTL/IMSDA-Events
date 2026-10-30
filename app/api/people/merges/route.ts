import { duplicateMatchApiError } from "@/modules/people/duplicate-match-api-errors";
import { requirePersonMergePermission } from "@/modules/people/person-merge-access";
import { listActivePersonMerges } from "@/modules/people/person-merge-repository";
import { withRequestContext } from "@/lib/request-context";

/** Lists active merges for the "Merged people" list. */
async function getHandler() {
  try {
    await requirePersonMergePermission();
    return Response.json({ merges: await listActivePersonMerges() });
  } catch (error) {
    return duplicateMatchApiError(error, "Loading merged people");
  }
}

export const GET = withRequestContext(getHandler);
