import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { budgetApiError } from "@/modules/event-budgets/api-errors";
import { budgetSettingsSchema } from "@/modules/event-budgets/domain";
import { applyBudgetSettings, requireAreaCoordinatorBudgetToggleActor } from "@/modules/event-budgets/settings";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator switches the Budget sheet on or off for a club event (#1682). An active grant, the second sign-in step
 * passed, this one module on club events. Anyone else gets "not found".
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorBudgetToggleActor();
    const { eventId } = await context.params;
    const input = budgetSettingsSchema.parse(await request.json());
    const state = await applyBudgetSettings(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return budgetApiError(error, "Saving the Budget sheet setting");
  }
}

export const PUT = withRequestContext(putHandler);
