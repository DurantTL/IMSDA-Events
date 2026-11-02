import { WhosMissingTable } from "@/components/club-screen-tables";
import { CoordinatorSetupHelp } from "@/components/role-setup-help";
import type { WhosMissingRow } from "@/modules/club-reports/whos-missing-what";
import { WHOS_MISSING_ANCHOR } from "@/modules/setup-help/coordinator-checklist";

/**
 * "Who's missing what" (#1435): each club in this coordinator's Overview that is missing something, with one next
 * step. It only draws rows `whosMissingWhat` made from the Overview's own club list. Status chips are the shared
 * `.status-chip` (Missing and Late are coral). Read only: it sends nothing.
 */
export function CoordinatorWhosMissing({ rows, clubCount, monthLabel, query = "", totalMissing = rows.length }: { rows: readonly WhosMissingRow[]; clubCount: number; monthLabel: string; query?: string; totalMissing?: number }) {
  return (
    <section aria-labelledby="coordinator-whos-missing-title" className="coordinator-panel" id={WHOS_MISSING_ANCHOR}>
      <h3 id="coordinator-whos-missing-title">Who&apos;s missing what</h3>
      {clubCount === 0 ? (
        <p>There are no clubs to follow up on.</p>
      ) : totalMissing === 0 ? (
        <p>Every club has a director, a roster and its {monthLabel} record.</p>
      ) : rows.length === 0 ? (
        <p>{totalMissing} of {clubCount} {clubCount === 1 ? "club is" : "clubs are"} missing something. None of them match “{query}”.</p>
      ) : (
        <>
          <p className="coordinator-count">{totalMissing} of {clubCount} {clubCount === 1 ? "club is" : "clubs are"} missing something. Each has one next step.{query && ` ${rows.length} listed below match “${query}”.`}</p>
          <WhosMissingTable rows={rows} />
        </>
      )}
      <CoordinatorSetupHelp context="clubs that are behind" id="whos-missing" />
    </section>
  );
}
