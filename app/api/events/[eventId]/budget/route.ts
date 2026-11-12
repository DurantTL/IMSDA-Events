import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { budgetApiError } from "@/modules/event-budgets/api-errors";
import { budgetSettingsSchema } from "@/modules/event-budgets/domain";
import { applyBudgetSettings, requireStaffBudgetToggleAccess } from "@/modules/event-budgets/settings";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * Staff switch the Budget sheet on or off (#1682): an Event Admin on this event or a system administrator. The Clubs
 * Administrator role alone does not qualify; Registration Managers and Finance Managers are refused. Audited.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireStaffBudgetToggleAccess(await getCurrentSession(), eventId, findActiveMembership);
    const input = budgetSettingsSchema.parse(await request.json());
    const state = await applyBudgetSettings(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return budgetApiError(error, "Saving the Budget sheet setting");
  }
}

export const PUT = withRequestContext(putHandler);
