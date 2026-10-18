import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubOrderApiError } from "@/modules/club-orders/api-errors";
import { requireClassHistoryEditAccess } from "@/modules/earned-awards/class-history-access";
import { changeMemberClassCompletionDate, removeMemberClassCompletion } from "@/modules/earned-awards/order-source";
import { changeMemberClassCompletionDateSchema, memberClassLevelParamSchema } from "@/modules/earned-awards/schemas";

type RouteContext = { params: Promise<{ organizationId: string; personId: string; classLevel: string }> };

/** Changes the completed date of one recorded class (#1011). */
async function patchHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, personId, classLevel } = await context.params;
    const actor = await requireClassHistoryEditAccess(organizationId);
    const level = memberClassLevelParamSchema.parse(classLevel);
    const body = changeMemberClassCompletionDateSchema.parse(await request.json());
    return Response.json(await changeMemberClassCompletionDate(organizationId, personId, level, body.completedOn, actor));
  } catch (error) {
    return clubOrderApiError(error, "Changing a class completed date");
  }
}

/** Removes one recorded class. A not-yet-ordered insignia need goes with it; an ordered one is left alone (#1011). */
async function deleteHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, personId, classLevel } = await context.params;
    const actor = await requireClassHistoryEditAccess(organizationId);
    const level = memberClassLevelParamSchema.parse(classLevel);
    return Response.json(await removeMemberClassCompletion(organizationId, personId, level, actor));
  } catch (error) {
    return clubOrderApiError(error, "Removing a class from the class history");
  }
}

export const PATCH = withRequestContext(patchHandler);
export const DELETE = withRequestContext(deleteHandler);
