import { assertBudgetAccess, requireAreaCoordinatorBudgetActor } from "@/modules/event-budgets/access";
import { budgetApiError } from "@/modules/event-budgets/api-errors";
import { buildBudgetExport } from "@/modules/event-budgets/repository";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { withRequestContext } from "@/lib/request-context";

/**
 * The Budget sheet as a CSV for the conference (#1682), for an Area Coordinator: totals, counts and cost lines only, no
 * personal data. An active grant and the second sign-in step; the module must be on. The download is audited.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const actor = await requireAreaCoordinatorBudgetActor();
    const { eventId } = await context.params;
    const event = await assertBudgetAccess(actor, eventId, "read");
    const { csv, slug } = await buildBudgetExport(actor, eventId, event.name);
    return csvDownloadResponse(csv, exportFileName({ scope: slug ?? eventId, kind: "budget-sheet" }));
  } catch (error) {
    return budgetApiError(error, "Downloading the budget sheet");
  }
}

export const GET = withRequestContext(getHandler);
