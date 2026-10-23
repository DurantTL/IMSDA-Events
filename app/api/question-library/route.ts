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
    // Authorize first: only the event id is read from the body to know which permission to check; nothing else is parsed until the caller is let in.
    const body = await readQuestionLibraryJson(request);
    const claimedEventId = body && typeof body === "object" && typeof (body as { eventId?: unknown }).eventId === "string" ? (body as { eventId: string }).eventId.trim() : null;
    const actor = await requireQuestionLibraryBuilder(claimedEventId || null);
    const input = saveLibraryItemSchema.parse(body);
    const saved = await createLibraryItem({ name: input.name, description: input.description, fields: input.fields }, actor);
    return Response.json(saved, { status: 201, headers: questionLibraryNoStore });
  } catch (error) {
    return questionLibraryApiError(error, "Saving a question to the library");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
