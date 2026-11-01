import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { BackgroundCheckImportPanel } from "@/components/background-check-import-panel";
import { BackgroundCheckReviewPanel } from "@/components/background-check-review-panel";
import { ColumnHeader, SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { serverSort, sortOrderText, sortRows, type SortValue } from "@/lib/list-sort";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { backgroundCheckSummary } from "@/modules/background-checks/repository";
import { AdminPageHeader } from "@/components/admin-page-header";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export const metadata: Metadata = { title: "Sterling Volunteers" };
export const dynamic = "force-dynamic";

/**
 * Sterling Volunteers (#388, #427): the upload, what's on file, and which
 * youth or children's events have adults still needing a check. Moved under
 * Clubs and churches (#427); `/admin/background-checks` redirects here.
 */
const EVENT_SORT_COLUMNS = ["event", "starts", "adults", "needed"] as const;
type EventSortColumn = typeof EVENT_SORT_COLUMNS[number];
type EventRow = Awaited<ReturnType<typeof backgroundCheckSummary>>["events"][number];
const eventAccessors: Record<EventSortColumn, (event: EventRow) => SortValue> = {
  event: (event) => event.name,
  starts: (event) => event.startsOn,
  adults: (event) => event.adults,
  needed: (event) => event.needed,
};
const eventSortLabels: Record<EventSortColumn, string> = { event: "event", starts: "start date", adults: "adults", needed: "adults needing a check" };

export default async function BackgroundChecksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const summary = await backgroundCheckSummary();
  // The event table is the whole list, so it is sorted here (#1458); the order never changes which events are listed.
  const sorting = serverSort<EventSortColumn>("/admin/organizations/background-checks", await searchParams, EVENT_SORT_COLUMNS, { key: null, dir: "asc" }, { hash: "#events" });
  const events = sorting.order.key ? sortRows(summary.events, sorting.order.key, sorting.order.dir, eventAccessors) : summary.events;
  const cards = [
    { label: "Current checks", value: summary.current, detail: "Clear, or a Sterling check good for more than 60 days. Does not include the expiring-soon checks below", tone: "green" },
    { label: "Expiring soon", value: summary.expiringSoon, detail: "Marked \"!\" on the roster, or a Sterling check ending within 60 days", tone: "gold" },
    { label: "Not current", value: summary.notCurrent, detail: "Not in compliance or expired; flagged at youth events", tone: "purple" },
    { label: "Needs a look", value: summary.reviewCount, detail: `Rows waiting on a staff decision. ${summary.unmatchedCount} more match no club roster or registration yet; that isn't work to do.`, tone: "coral" },
  ];
  return (
    <section className="page-stack">
      <AdminPageHeader path="/admin/organizations/background-checks" />
      <StaffPageHeader
        description="Upload the roster export (matched by name and club or church; no email or birth date needed) or the older Sterling Volunteers list. The newest upload replaces whatever was on file for a person."
        primary={<BackgroundCheckImportPanel />}
      />
      <div className="meta-stack">
        <p className="field-help">
          At events marked as youth or children&apos;s events (in Event settings), every adult with no check on file, an
          expired check, or a roster mark of not in compliance is flagged in red on the dashboard, People, rosters,
          and check-in. Expiring soon is not flagged there, and registration is never blocked. At those events check-in is held for adults and staff who are not current unless staff override.
        </p>
        <p className="field-help">
          Each adult on a club&apos;s roster shows Clear, Expiring soon, Not in compliance, or No record. Club
          directors and deputies see the status only; the roster note, with the check and training dates, is shown
          to staff only.
        </p>
        {summary.lastRecordedAt && (
          <p className="field-help">Last recorded {formatInConferenceTime(summary.lastRecordedAt, { dateStyle: "medium", timeStyle: "short" })}.</p>
        )}
      </div>

      <section className="report-summary-grid" aria-label="Sterling Volunteers on file">
        {cards.map((card) => (
          <article className={`metric-card report-summary-card accent-${card.tone}`} key={card.label}>
            <strong>{card.value}</strong><p>{card.label}</p><small>{card.detail}</small>
          </article>
        ))}
      </section>

      <section className="panel" id="events">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Upcoming</p>
            <h2>Youth and children&apos;s events</h2>
            <p>Events that check adults. Open one&apos;s reports for the full list.</p>
          </div>
        </div>
        {summary.events.length === 0 ? (
          <p className="report-empty">No upcoming event is marked as a youth or children&apos;s event. Turn it on in an event&apos;s settings.</p>
        ) : (
          <div className="report-table-wrap">
            {sorting.order.key && <SortOrderNote>{sortOrderText(eventSortLabels[sorting.order.key], sorting.order.dir, sorting.order.key === "event" ? "text" : sorting.order.key === "starts" ? "date" : "number")}</SortOrderNote>}
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Youth and children&apos;s events</caption>
              <thead role="rowgroup"><tr role="row">
                <ColumnHeader column="event" label="Event" sorting={sorting} />
                <ColumnHeader column="starts" label="Starts" sorting={sorting} />
                <ColumnHeader column="adults" label="Adults" sorting={sorting} />
                <ColumnHeader column="needed" label="Need a check" sorting={sorting} />
              </tr></thead>
              <tbody role="rowgroup">
                {events.map((event) => (
                  <tr role="row" key={event.id}>
                    <th role="rowheader" scope="row"><Link className="report-record-link" href={`/more/reports?event=${encodeURIComponent(event.id)}#background-checks`}>{event.name}</Link></th>
                    <td {...cardCell("Starts")}>{event.startsOn}</td>
                    <td {...cardCell("Adults")}>{event.adults}</td>
                    <td {...cardCell("Need a check")}>
                      {event.needed > 0
                        ? <span className="status-chip coral background-check-badge"><ShieldAlert aria-hidden="true" size={12} /> {event.needed}</span>
                        : <span className="status-chip green background-check-badge"><ShieldCheck aria-hidden="true" size={12} /> All current</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BackgroundCheckReviewPanel />
    </section>
  );
}
