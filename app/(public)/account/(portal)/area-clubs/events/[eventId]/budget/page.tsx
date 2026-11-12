import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { BudgetLastYear } from "@/components/budget-last-year";
import { BudgetPanel } from "@/components/budget-panel";
import { BudgetSheetEditor } from "@/components/budget-sheet";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { logError } from "@/lib/logger";
import { BudgetError, assertBudgetAccess, requireAreaCoordinatorBudgetActor } from "@/modules/event-budgets/access";
import { loadBudgetSheet, loadCarriedBudget } from "@/modules/event-budgets/repository";
import { loadBudgetToolState } from "@/modules/event-budgets/settings";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Budget sheet", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * The Budget sheet for one club event (#1682): the optional tool an Area Coordinator switches on, then fills with costs. Their
 * write is the switch and the cost lines. Staff acting as a coordinator (#442) see a view-only note and no sheet.
 */
export default async function AreaBudgetPage({ params }: { params: Promise<{ eventId: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const { eventId } = await params;
  const account = await currentAreaCoordinator();
  const loaded = account
    ? await (async () => {
      const state = await loadBudgetToolState(eventId, "area-coordinator");
      if (!state.enabled) return { state, sheet: null, carried: null };
      const actor = await requireAreaCoordinatorBudgetActor();
      await assertBudgetAccess(actor, eventId, "read");
      const [sheet, carried] = await Promise.all([loadBudgetSheet(eventId, state.eventName), loadCarriedBudget(actor, eventId)]);
      return { state, sheet, carried };
    })().catch((error: unknown) => {
      if (error instanceof BudgetError && error.code === "EVENT_NOT_FOUND") return "missing" as const;
      logError("Coordinator budget sheet read failed", error, { eventId });
      return null;
    })
    : "view-only" as const;
  if (loaded === "missing") notFound();
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <BackLink href="/account/area-clubs/events">Back to club events</BackLink>
      {loaded === null ? (
        <CoordinatorUnavailable what="Budget sheet" />
      ) : loaded === "view-only" ? (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Budget sheet</h2>
          </div>
          <p className="field-help">Only an Area Coordinator signed in with their own account can use this tool.</p>
        </>
      ) : (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Budget sheet<br /><span translate="no">{loaded.state.eventName}</span></h2>
          </div>
          <p className="field-help">
            An optional planning sheet, not accounting. Income and head counts fill in from registrations; you add the costs.
            It never changes a payment or a registration. Turning it off hides it and keeps the costs.
          </p>
          <BudgetPanel endpoint={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/budget`} initial={{ enabled: loaded.state.enabled }} />
          {loaded.sheet && (
            <>
              <BudgetSheetEditor
                canEdit
                endpoint={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/budget/lines`}
                eventName={loaded.state.eventName}
                exportHref={`/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/budget/export`}
                figures={loaded.sheet.figures}
                initialLines={loaded.sheet.costLines}
              />
              {loaded.carried && <BudgetLastYear carried={loaded.carried} />}
            </>
          )}
        </>
      )}
    </section>
  );
}
