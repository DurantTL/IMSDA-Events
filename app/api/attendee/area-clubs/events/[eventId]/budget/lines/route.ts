import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireAreaCoordinatorBudgetActor } from "@/modules/event-budgets/access";
import { budgetApiError } from "@/modules/event-budgets/api-errors";
import { costLineDeleteSchema, costLineInputSchema, costLineUpdateSchema } from "@/modules/event-budgets/domain";
import { createCostLine, deleteCostLine, updateCostLine } from "@/modules/event-budgets/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator adds, changes and deletes cost lines on a club event's Budget sheet (#1682). An active grant and the
 * second sign-in step; the module must be on. Each change is audited with amounts only. Anyone else gets "not found".
 */
const noStore = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ eventId: string }> };

async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorBudgetActor();
    const { eventId } = await context.params;
    const line = await createCostLine(actor, eventId, costLineInputSchema.parse(await request.json()));
    return Response.json({ line }, { status: 201, headers: noStore });
  } catch (error) {
    return budgetApiError(error, "Adding the cost line");
  }
}

async function patchHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorBudgetActor();
    const { eventId } = await context.params;
    const { id, ...input } = costLineUpdateSchema.parse(await request.json());
    const line = await updateCostLine(actor, eventId, id, input);
    return Response.json({ line }, { headers: noStore });
  } catch (error) {
    return budgetApiError(error, "Saving the cost line");
  }
}

async function deleteHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorBudgetActor();
    const { eventId } = await context.params;
    const { id } = costLineDeleteSchema.parse(await request.json());
    await deleteCostLine(actor, eventId, id);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return budgetApiError(error, "Deleting the cost line");
  }
}

export const POST = withRequestContext(postHandler);
export const PATCH = withRequestContext(patchHandler);
export const DELETE = withRequestContext(deleteHandler);
