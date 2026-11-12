import { getCurrentSession } from "@/modules/access/current-session";
import { assertBudgetAccess, requireStaffBudgetReader } from "@/modules/event-budgets/access";
import { budgetApiError } from "@/modules/event-budgets/api-errors";
import { buildBudgetExport } from "@/modules/event-budgets/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { withRequestContext } from "@/lib/request-context";

/**
 * The Budget sheet as a CSV for the conference (#1682): totals, counts and cost lines only, no personal data. Staff holding
 * MANAGE_FINANCE or VIEW_REPORTS on the event, and system administrators. The download is audited.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    const session = await getCurrentSession();
    const actor = await requireStaffBudgetReader(session, eventId, findActiveMembership);
    const event = await assertBudgetAccess(actor, eventId, "read");
    const { csv, slug } = await buildBudgetExport(actor, eventId, event.name, { session, lookup: findActiveMembership });
    return csvDownloadResponse(csv, exportFileName({ scope: slug ?? eventId, kind: "budget-sheet" }));
  } catch (error) {
    return budgetApiError(error, "Downloading the budget sheet");
  }
}

export const GET = withRequestContext(getHandler);
