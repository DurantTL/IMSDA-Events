import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireQuestionLibraryManager } from "@/modules/question-library/access";
import { questionLibraryApiError, questionLibraryNoStore, readQuestionLibraryJson } from "@/modules/question-library/api";
import { updateLibraryItemSchema } from "@/modules/question-library/domain";
import { archiveLibraryItem, updateLibraryItem } from "@/modules/question-library/repository";

type Context = { params: Promise<{ itemId: string }> };

/** System administrators rename or edit a saved question (#1070). Questions already added to forms are independent copies and do not change. */
async function patchHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireQuestionLibraryManager();
    const { itemId } = await context.params;
    const input = updateLibraryItemSchema.parse(await readQuestionLibraryJson(request));
    await updateLibraryItem(itemId, input, actor);
    return Response.json({ id: itemId }, { headers: questionLibraryNoStore });
  } catch (error) {
    return questionLibraryApiError(error, "Editing a saved question");
  }
}

/** System administrators delete a saved question (#1070). It leaves the library; inserted copies and published versions stay as they are. */
async function deleteHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireQuestionLibraryManager();
    const { itemId } = await context.params;
    await archiveLibraryItem(itemId, actor);
    return Response.json({ id: itemId }, { headers: questionLibraryNoStore });
  } catch (error) {
    return questionLibraryApiError(error, "Deleting a saved question");
  }
}

export const PATCH = withRequestContext(patchHandler);
export const DELETE = withRequestContext(deleteHandler);
