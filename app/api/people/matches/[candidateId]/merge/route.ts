import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { duplicateMatchApiError } from "@/modules/people/duplicate-match-api-errors";
import { requirePersonMergePermission } from "@/modules/people/person-merge-access";
import { mergeMatchCandidate } from "@/modules/people/person-merge-repository";
import { withRequestContext } from "@/lib/request-context";

const mergeInputSchema = z.object({
  primaryPersonId: z.string().trim().min(1, "Choose which person to keep as the primary."),
  reason: z.string().trim().min(5, "A merge reason of at least five characters is required."),
});

/** Staff-reviewed soft-merge of one candidate's two people. Reversible with unmerge. */
async function postHandler(
  request: Request,
  context: { params: Promise<{ candidateId: string }> },
) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requirePersonMergePermission();
    const { candidateId } = await context.params;
    const { primaryPersonId, reason } = mergeInputSchema.parse(await request.json());
    const merge = await mergeMatchCandidate(candidateId, primaryPersonId, actor.id, reason);
    return Response.json({ merge: { id: merge.id, state: merge.state } });
  } catch (error) {
    return duplicateMatchApiError(error, "Merging people");
  }
}

export const POST = withRequestContext(postHandler);
