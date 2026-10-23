import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireQuestionLibraryBuilder } from "@/modules/question-library/access";
import { questionLibraryApiError, questionLibraryNoStore, readQuestionLibraryJson } from "@/modules/question-library/api";
import { saveLibraryItemSchema } from "@/modules/question-library/domain";
import { createLibraryItem, listLibraryItems } from "@/modules/question-library/repository";

/** Anyone who can build forms reads the library, for the event they are building for (#1070). No event: system administrators only. */
async function getHandler(request: Request) {
  try {
    const eventId = new URL(request.url).searchParams.get("eventId");
    await requireQuestionLibraryBuilder(eventId);
    return Response.json({ items: await listLibraryItems() }, { headers: questionLibraryNoStore });
  } catch (error) {
    return questionLibraryApiError(error, "Listing saved questions");
  }
}

/** Anyone who can build forms saves a question to the library (#1070). The fragment is validated with the form definition's field schema. */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const input = saveLibraryItemSchema.parse(await readQuestionLibraryJson(request));
    const actor = await requireQuestionLibraryBuilder(input.eventId);
    const saved = await createLibraryItem({ name: input.name, description: input.description, fields: input.fields }, actor);
    return Response.json(saved, { status: 201, headers: questionLibraryNoStore });
  } catch (error) {
    return questionLibraryApiError(error, "Saving a question to the library");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
