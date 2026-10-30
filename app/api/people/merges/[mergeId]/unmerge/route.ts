import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { duplicateMatchApiError } from "@/modules/people/duplicate-match-api-errors";
import { requirePersonMergePermission } from "@/modules/people/person-merge-access";
import { unmergePeople } from "@/modules/people/person-merge-repository";
import { withRequestContext } from "@/lib/request-context";

const unmergeInputSchema = z.object({
  reason: z.string().trim().min(5, "An unmerge reason of at least five characters is required."),
});

/** Reverses an active merge. The merge row is kept as REVERSED, never deleted. */
async function postHandler(
  request: Request,
  context: { params: Promise<{ mergeId: string }> },
) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requirePersonMergePermission();
    const { mergeId } = await context.params;
    const { reason } = unmergeInputSchema.parse(await request.json());
    const merge = await unmergePeople(mergeId, actor.id, reason);
    return Response.json({ merge: { id: merge.id, state: merge.state } });
  } catch (error) {
    return duplicateMatchApiError(error, "Unmerging people");
  }
}

export const POST = withRequestContext(postHandler);
