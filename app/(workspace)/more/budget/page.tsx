import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { BudgetLastYear } from "@/components/budget-last-year";
import { BudgetPanel } from "@/components/budget-panel";
import { BudgetSheetEditor } from "@/components/budget-sheet";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { staffPageTitles } from "@/components/staff-navigation";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { BudgetError, requireStaffBudgetReader } from "@/modules/event-budgets/access";
import { loadBudgetSheet, loadCarriedBudget } from "@/modules/event-budgets/repository";
import { loadBudgetToolState } from "@/modules/event-budgets/settings";
import { findActiveMembership } from "@/modules/events/repository";
import { resolveEventContext } from "@/modules/events/selection";

export const metadata: Metadata = { title: staffPageTitles.eventBudget };
export const dynamic = "force-dynamic";

/**
 * Staff screen for the optional Budget sheet (#1682): the switch, and the sheet itself. Switching is for a system administrator,
 * an Event Admin or the Clubs Administrator; reading is for staff holding MANAGE_FINANCE or VIEW_REPORTS and system administrators;
 * changing a cost line needs MANAGE_FINANCE. All checked on the server, here and again by every API route the sheet calls.
 */
export default async function EventBudgetPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const requested = (await searchParams).event;
  const { event, user, membership } = await resolveEventContext(requested);
  const canSwitch = user.globalRole === "SYSTEM_ADMIN" || membership?.role === "EVENT_ADMIN";
  const session = await getCurrentSession();
  const reader = await requireStaffBudgetReader(session, event.id, findActiveMembership).catch(() => null);
  if (!canSwitch && !reader) {
    return <AccessRestricted title="The budget sheet is restricted" detail="Finance staff, staff who view reports and event administrators can open the budget sheet. Event administrators and the Clubs Administrator turn it on." whoToAsk="your event administrator" />;
  }
  let loaded: { state: Awaited<ReturnType<typeof loadBudgetToolState>>; sheet: Awaited<ReturnType<typeof loadBudgetSheet>> | null; carried: Awaited<ReturnType<typeof loadCarriedBudget>> | null };
  try {
    const state = await loadBudgetToolState(event.id, "staff");
    loaded = state.enabled && reader
      ? { state, sheet: await loadBudgetSheet(event.id, event.name), carried: await loadCarriedBudget(reader, event.id, { session, lookup: findActiveMembership }) }
      : { state, sheet: null, carried: null };
  } catch (error) {
    if (error instanceof BudgetError && error.code === "EVENT_NOT_FOUND") {
      return <NotAvailableForEvent reason="The budget sheet is for club events. Choose a club event, or this one may be archived." />;
    }
    logError("Budget sheet page read failed", error, { eventId: event.id });
    return (
      <section className="page-stack">
        <div className="panel page-stack">
          <h2>Budget sheet</h2>
          <p>The budget sheet couldn&apos;t be loaded right now.</p>
          <p className="field-help">Pick another event from the event menu, or <Link href="/more">go back to More</Link> and try again.</p>
        </div>
      </section>
    );
  }
  const { state, sheet, carried } = loaded;
  return (
    <section className="page-stack">
      <div className="panel page-stack">
        <h2>Budget sheet<br /><span translate="no">{event.name}</span></h2>
        <p className="field-help">
          An optional planning sheet, not accounting. Income and head counts fill in from registrations and match Finance and the reports; costs are added by hand.
          It never changes a payment, invoice or registration. Turning it off hides it and keeps the costs.
        </p>
        {canSwitch ? (
          <BudgetPanel endpoint={`/api/events/${encodeURIComponent(event.id)}/budget`} initial={{ enabled: state.enabled }} />
        ) : (
          <p className="field-help">The budget sheet is {state.enabled ? "on" : "off"}. Event administrators and the Clubs Administrator turn it on or off.</p>
        )}
      </div>
      {sheet && reader && (
        <div className="panel page-stack">
          <BudgetSheetEditor
            canEdit={reader.canWrite}
            endpoint={`/api/events/${encodeURIComponent(event.id)}/budget/lines`}
            eventName={event.name}
            exportHref={`/api/events/${encodeURIComponent(event.id)}/budget/export`}
            figures={sheet.figures}
            initialLines={sheet.costLines}
          />
          {carried && <BudgetLastYear carried={carried} />}
        </div>
      )}
    </section>
  );
}
