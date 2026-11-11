import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { ColumnHeader } from "@/components/column-header";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { BackgroundCheckImportPanel } from "@/components/background-check-import-panel";
import { BackgroundCheckReviewPanel } from "@/components/background-check-review-panel";
import { SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { serverSort, sortOrderText, sortRows, type SortValue } from "@/lib/list-sort";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { backgroundCheckSummary } from "@/modules/background-checks/repository";
import { listSterlingActionPeople } from "@/modules/background-checks/reminders";
import {
  DEFAULT_REMINDER_FILTER,
  NEEDS_A_LOOK_ID,
  REMINDER_FILTERS,
  SORT_KEYS as FOLLOW_UP_SORT_KEYS,
  parseReminderFilter,
  reminderFilterLabels,
  type ReminderFilter,
  type ReminderSortKey,
} from "@/modules/background-checks/reminders-domain";
import { ListPager } from "@/components/list-pager";
import { SterlingFollowUp } from "@/components/sterling-follow-up";
import { parsePageParam } from "@/lib/pagination";
import { searchPageHref } from "@/lib/search-page-href";
import styles from "@/components/sterling-follow-up.module.css";
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

const PAGE_PATH = "/admin/organizations/background-checks";
const FOLLOW_UP_HASH = "#follow-up";
const followUpSortLabels: Record<ReminderSortKey, { label: string; kind: "text" | "date" }> = {
  name: { label: "last name", kind: "text" },
  club: { label: "club", kind: "text" },
  expires: { label: "expiry date", kind: "date" },
};

export default async function BackgroundChecksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const summary = await backgroundCheckSummary();
  // The event table is the whole list, so it is sorted here (#1458); the order never changes which events are listed.
  const sorting = serverSort<EventSortColumn>(PAGE_PATH, await searchParams, EVENT_SORT_COLUMNS, { key: null, dir: "asc" }, { hash: "#events" });
  const events = sorting.order.key ? sortRows(summary.events, sorting.order.key, sorting.order.dir, eventAccessors) : summary.events;
  const params = await searchParams;
  const filter = parseReminderFilter(params.people);
  const followUpSort = serverSort<ReminderSortKey>(PAGE_PATH, params, FOLLOW_UP_SORT_KEYS, { key: "expires", dir: "asc" }, { prefix: "people", hash: FOLLOW_UP_HASH });
  const followUp = await listSterlingActionPeople({
    filter,
    sort: followUpSort.order.key ?? "expires",
    dir: followUpSort.order.dir,
    page: parsePageParam(typeof params.peoplePage === "string" ? params.peoplePage : undefined),
  });
  const filterHref = (value: ReminderFilter) => `${PAGE_PATH}${value === DEFAULT_REMINDER_FILTER ? "" : `?people=${value}`}${FOLLOW_UP_HASH}`;
  const filterCounts: Record<ReminderFilter, number> = { expiring: followUp.counts.expiring, "not-current": followUp.counts.notCurrent, all: followUp.counts.all };
  const sortInfo = followUpSortLabels[followUpSort.order.key ?? "expires"];
  const followUpColumns = {
    name: { href: followUpSort.hrefFor("name"), active: followUpSort.order.key === "name", direction: followUpSort.order.dir },
    club: { href: followUpSort.hrefFor("club"), active: followUpSort.order.key === "club", direction: followUpSort.order.dir },
    expires: { href: followUpSort.hrefFor("expires"), active: followUpSort.order.key === "expires", direction: followUpSort.order.dir },
  };
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

      <nav aria-label="Jump to the people who need action">
        <ul className={styles.filters}>
          {REMINDER_FILTERS.filter((value) => value !== "all").map((value) => (
            <li key={value}>
              <Link aria-current={filter === value ? "true" : undefined} href={filterHref(value)}>{reminderFilterLabels[value]} ({filterCounts[value]})</Link>
            </li>
          ))}
          <li><a href={`#${NEEDS_A_LOOK_ID}`}>Needs a look ({summary.reviewCount})</a></li>
          <li>
            <Link aria-current={filter === "all" ? "true" : undefined} href={filterHref("all")}>{reminderFilterLabels.all} ({filterCounts.all})</Link>
          </li>
        </ul>
        <p className={styles.current}>
          Current checks: {followUp.counts.current}. Counted from the active adults and staff on this year&apos;s club rosters. Expiring soon is within 60 days.
          {summary.unmatchedCount > 0 && <> {summary.unmatchedCount} more rows in the upload match no club roster or registration yet; that isn&apos;t work to do.</>}
        </p>
      </nav>

      <section className="panel" id="follow-up">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Sterling Volunteers</p>
            <h2>People to follow up</h2>
            <p>Filter: {reminderFilterLabels[filter].toLowerCase()}. Choose people and send a reminder to their club director(s), and to the volunteer when an email is on file.</p>
          </div>
        </div>
        <ListPager hrefFor={(page) => searchPageHref(PAGE_PATH, params, page, { prefix: "people", hash: FOLLOW_UP_HASH })} label="People to follow up pages" noun="people" nounOne="person" part="count" slice={followUp} />
        <SterlingFollowUp
          columns={followUpColumns}
          filter={filter}
          key={`${filter}:${followUpSort.order.key}:${followUpSort.order.dir}:${followUp.page}`}
          reminderTotal={filter === "all" ? followUp.counts.expiring + followUp.counts.notCurrent : followUp.total}
          rows={followUp.items}
          sortNote={sortOrderText(sortInfo.label, followUpSort.order.dir, sortInfo.kind)}
        />
        <ListPager hrefFor={(page) => searchPageHref(PAGE_PATH, params, page, { prefix: "people", hash: FOLLOW_UP_HASH })} label="People to follow up pages" part="pages" slice={followUp} />
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
