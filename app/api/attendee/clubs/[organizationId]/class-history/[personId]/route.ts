import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { classHistoryApiError } from "@/modules/earned-awards/class-history-api-errors";
import { requireClassHistoryEditAccess } from "@/modules/earned-awards/class-history-access";
import { addMemberClassCompletion } from "@/modules/earned-awards/order-source";
import { addMemberClassCompletionSchema } from "@/modules/earned-awards/schemas";

type RouteContext = { params: Promise<{ organizationId: string; personId: string }> };

/** Adds a class to one person's class history (#1011). Director, deputy and registrar (the roster's own gate). */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, personId } = await context.params;
    const actor = await requireClassHistoryEditAccess(organizationId);
    const body = addMemberClassCompletionSchema.parse(await request.json());
    return Response.json(await addMemberClassCompletion(organizationId, personId, body, actor), { status: 201 });
  } catch (error) {
    return classHistoryApiError(error, "Adding a class to the class history");
  }
}

export const POST = withRequestContext(postHandler);
