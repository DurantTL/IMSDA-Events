import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { YouthAdministratorError, setYouthAdministrator } from "@/modules/access/youth-administrator";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { withRequestContext } from "@/lib/request-context";

/**
 * A system administrator gives (PUT) or takes away (DELETE) the Youth Admin
 * role (#1685). Audited. Nobody else can, a Youth Admin included. A removal
 * applies on the person's next request.
 */
type RouteContext = { params: Promise<{ userId: string }> };

async function change(request: Request, context: RouteContext, on: boolean) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator("Only a system administrator can change who is a Youth Admin.");
    const { userId } = await context.params;
    await setYouthAdministrator(userId, on, actor.id);
    return Response.json({ userId, youthAdministrator: on }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof YouthAdministratorError) {
      return Response.json({ error: error.code, message: error.message }, { status: 404 });
    }
    logError("Changing the Youth Admin role failed", error);
    return Response.json({ error: "YOUTH_ADMINISTRATOR_UPDATE_FAILED", message: "That role could not be changed." }, { status: 500 });
  }
}

export const PUT = withRequestContext((request: Request, context: RouteContext) => change(request, context, true));
export const DELETE = withRequestContext((request: Request, context: RouteContext) => change(request, context, false));
