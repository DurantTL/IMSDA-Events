import { withRequestContext } from "@/lib/request-context";
import { instructorApiError, requireInstructorAccount } from "@/modules/honors/instructor-api";
import { getInstructorRoster } from "@/modules/honors/instructor-repository";

/**
 * One class roster for the signed-in instructor (#833): name and club only.
 * 404 for any class that isn't theirs. A Sterling Volunteers check that isn't
 * current adds a `sterlingWarning` message and never blocks (#896). Never cached.
 */
async function getHandler(_request: Request, context: { params: Promise<{ offeringId: string }> }) {
  try {
    const account = await requireInstructorAccount();
    const { offeringId } = await context.params;
    const view = await getInstructorRoster(account.id, offeringId);
    return Response.json({ class: view.header, people: view.rows, sterlingWarning: view.sterlingWarning }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return instructorApiError(error, "Loading a class roster");
  }
}

export const GET = withRequestContext(getHandler);
