import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireStaffBudgetWriter } from "@/modules/event-budgets/access";
import { budgetApiError } from "@/modules/event-budgets/api-errors";
import { costLineDeleteSchema, costLineInputSchema, costLineUpdateSchema } from "@/modules/event-budgets/domain";
import { createCostLine, deleteCostLine, updateCostLine } from "@/modules/event-budgets/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Staff add, change and delete cost lines on a club event's Budget sheet (#1682). Needs MANAGE_FINANCE on the event (or a
 * system administrator); staff who only view reports read the sheet but cannot change it. Each change is audited with amounts only.
 */
const noStore = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ eventId: string }> };

async function actorFor(context: Context) {
  const { eventId } = await context.params;
  return { eventId, actor: await requireStaffBudgetWriter(await getCurrentSession(), eventId, findActiveMembership) };
}

async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, actor } = await actorFor(context);
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
    const { eventId, actor } = await actorFor(context);
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
    const { eventId, actor } = await actorFor(context);
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
