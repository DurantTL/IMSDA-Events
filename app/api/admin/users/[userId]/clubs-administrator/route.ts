import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { ClubsAdministratorError, setClubsAdministrator } from "@/modules/access/clubs-administrator";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { withRequestContext } from "@/lib/request-context";

/**
 * A system administrator gives (PUT) or takes away (DELETE) the Clubs Administrator
 * role (#1225). Audited. Nobody else can, a Clubs Administrator included. A removal
 * applies on the person's next request.
 */
type RouteContext = { params: Promise<{ userId: string }> };

async function change(request: Request, context: RouteContext, on: boolean) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator("Only a system administrator can change who is a Clubs Administrator.");
    const { userId } = await context.params;
    await setClubsAdministrator(userId, on, actor.id);
    return Response.json({ userId, clubsAdministrator: on }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof ClubsAdministratorError) {
      return Response.json({ error: error.code, message: error.message }, { status: 404 });
    }
    logError("Changing the Clubs Administrator role failed", error);
    return Response.json({ error: "CLUBS_ADMINISTRATOR_UPDATE_FAILED", message: "That role could not be changed." }, { status: 500 });
  }
}

export const PUT = withRequestContext((request: Request, context: RouteContext) => change(request, context, true));
export const DELETE = withRequestContext((request: Request, context: RouteContext) => change(request, context, false));
