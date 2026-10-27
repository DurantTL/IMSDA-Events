import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { CalendarDays, CalendarRange, DoorClosed, List } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { CalendarSubscribe } from "@/components/calendar-subscribe";
import { CalendarViewBar, type CalendarViewTab } from "@/components/calendar-view-bar";
import { AgendaItem } from "@/components/calendar-agenda-item";
import { CalendarDayLink } from "@/components/calendar-day-link";
import { CalendarDayFocus } from "@/components/calendar-day-focus";
import { CalendarMotion } from "@/components/calendar-motion";
import { calendarBarIntroDelay } from "@/components/calendar-motion-helpers";
import { CalendarMonthChip } from "@/components/calendar-month-chip";
import { CalendarPanelItem } from "@/components/calendar-panel-item";
import { eventTransitionNames } from "@/modules/events/view-transition";
import { EventPhotoCard, eventCardImage } from "@/components/event-photo-card";
import { eventSlugFromHref } from "@/modules/events/view-transition";
import { featuredItemsFor, withoutFeatured } from "@/modules/events/featured-domain";
import { listEventCardImages, listFeaturedEventRows } from "@/modules/events/featured";
import {
  calendarGridRows,
  calendarMoreLabel,
  calendarItemTone,
  calendarStatusLabels,
  calendarToneMap,
  closureLabel,
  filterByCategory,
  firstPerSeries,
  firstOfMonth,
  itemsOnDate,
  itemsOverlapping,
  lastOfMonth,
  monthGrid,
  monthKey,
  monthLabel,
  parseMonthParam,
  resolveMonthAndDate,
  formatDateRange,
  formatLongDate,
  formatWeekdayDate,
  calendarCountLabel,
  weekBarLayout,
  sortCalendarItems,
  shiftMonth,
  addDays,
  type CalendarItem,
  type CalendarTone,
} from "@/modules/calendar/domain";
import { calendarHref, parseCalendarView, type CalendarHrefParams } from "@/modules/calendar/calendar-href";
import { calendarFilterGroups, filterByGroup, resolveCalendarFilter } from "@/modules/calendar/filter-groups";
import { conferenceToday, listPublicCalendarItems } from "@/modules/calendar/repository";
import { buildCalendarYear, parseYearDate, parseYearParam } from "@/modules/calendar/year";
import { CalendarYearView } from "@/components/calendar-year-view";
import { buildSubscribeLinks, siteBaseUrl } from "@/modules/calendar/subscribe";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conference calendar",
  description: "Upcoming Iowa-Missouri Conference events, camps, and ministry dates.",
  alternates: { canonical: "/calendar" },
  robots: { index: true, follow: true },
};

type SearchParams = Promise<{ view?: string; month?: string; year?: string; filter?: string; category?: string; date?: string }>;

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The month list beside the grid shows this many items before "Show N more". */
const monthListPreview = 3;

/** The year list beside the Year view's grid shows this many items before "Show all N in the list". */
const yearListPreview = 8;

function groupByMonth(items: CalendarItem[], from: string) {
  const groups = new Map<string, CalendarItem[]>();
  for (const item of items) {
    // A multi-day item already under way is listed under the current month.
    const key = (item.startsOn < from ? from : item.startsOn).slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

export default async function PublicCalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const view = parseCalendarView(params.view);
  const { slug: filter, category } = resolveCalendarFilter(params.filter, params.category?.slice(0, 40) || undefined);
  const filterLabel = calendarFilterGroups.find((group) => group.slug === filter)?.label ?? "";
  const today = conferenceToday();
  // A selected date (month view only) shows only that date's items in the month list and decides the month shown, so an
  // adjacent-month date from the grid lands on its own month instead of a list that excludes it.
  const { selectedDate: monthDate, month } = resolveMonthAndDate(view, params.month, params.date, today);
  // The Year view shows one calendar year (#1250); its date is honoured only inside that year.
  const year = parseYearParam(params.year, today);
  const selectedDate = view === "year" ? parseYearDate(params.date, year) : monthDate;

  const grid = monthGrid(month);
  const from = view === "month" ? grid[0][0] : view === "year" ? `${year}-01-01` : today;
  const to = view === "month" ? grid[grid.length - 1][6] : view === "year" ? `${year}-12-31` : addDays(today, 365);
  const allItems = await listPublicCalendarItems(from, to);
  // Colours come from every item before any filter, so choosing a chip never changes a colour (#1202).
  const toneMap = calendarToneMap(allItems);
  const items = filterByCategory(filterByGroup(allItems, filter), category);
  const monthItems = itemsOverlapping(items, firstOfMonth(month), lastOfMonth(month));
  const currentMonthKey = monthKey(month);
  const monthParam = view === "month" ? params.month : undefined;
  const base: CalendarHrefParams = { view, month: monthParam, filter, category };
  const selectedItems = selectedDate ? itemsOnDate(items, selectedDate) : [];
  const monthName = monthLabel(month).split(" ")[0];
  const previewItems = monthItems.slice(0, monthListPreview);
  const moreItems = monthItems.slice(monthListPreview);
  // View-transition names must be unique on the page (#1208): in month view the day panel is named first, or else the month
  // list; the list view names its own list.
  const usedTransitionNames = new Set<string>();
  // The list view pins featured events above the list (#1218), in the chosen filter, and leaves them out of the list
  // below so no card shows twice. The month view is unchanged.
  const featuredItems = view === "list" ? featuredItemsFor(items, await listFeaturedEventRows(today)) : [];
  const featuredImages = await listEventCardImages(featuredItems.flatMap((item) => {
    const slug = eventSlugFromHref(item.href);
    return slug ? [slug] : [];
  }));
  const featuredNames = eventTransitionNames(featuredItems, usedTransitionNames);
  const listItems = withoutFeatured(firstPerSeries(items), featuredItems, "item");
  const panelNames = eventTransitionNames(view === "month" ? sortCalendarItems(selectedItems) : [], usedTransitionNames);
  const agendaNames = eventTransitionNames(view === "month" ? (selectedDate ? [] : monthItems) : view === "list" ? listItems : [], usedTransitionNames);
  // A day (or a bar, or "+N more") shows that day alone in the month list; an adjacent-month day lands on its own month.
  const dayHrefFor = (date: string) => calendarHref(
    { view: "month", month: date.slice(0, 7) === currentMonthKey ? (selectedDate ? monthKey(month) : params.month) : date.slice(0, 7), filter, category, date },
    "calendar-day-detail",
  );
  const tabs: CalendarViewTab[] = [
    { key: "month", label: "Month", href: calendarHref({ view: "month", month: view === "year" && year !== Number(today.slice(0, 4)) ? `${year}-01` : monthParam, filter, category }), icon: <CalendarDays size={15} aria-hidden="true" /> },
    { key: "list", label: "Upcoming", href: calendarHref({ view: "list", filter, category }), icon: <List size={15} aria-hidden="true" /> },
    { key: "year", label: "Year", href: calendarHref({ view: "year", year: String(view === "month" ? month.year : view === "year" ? year : Number(today.slice(0, 4))), filter, category }), icon: <CalendarRange size={15} aria-hidden="true" /> },
  ];
  const chips = calendarFilterGroups.map((group) => ({
    slug: group.slug,
    label: group.label,
    href: calendarHref({ view, month: monthParam, year: view === "year" ? String(year) : undefined, filter: group.slug, date: selectedDate }),
  }));
  // The key names each colour the month shows: a category's own tone, navy for IMSDA events, stripes for closures.
  const keyEntries = view === "month" ? monthKeyEntries(monthItems, toneMap) : [];
  const calendarYear = view === "year" ? buildCalendarYear(year, items, toneMap) : null;
  const yearList = view === "year" ? firstPerSeries(itemsOverlapping(items, `${year}-01-01`, `${year}-12-31`)) : [];
  const yearKeyEntries = view === "year" ? monthKeyEntries(yearList, toneMap) : [];

  return (
    <main className="public-registration-page public-calendar-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <Link className="public-registration-brand public-event-brand-link" href="/">
            <BrandMark />
            <span><strong>IMSDA</strong><small>Events</small></span>
          </Link>
          <div className="public-header-links">
            <PublicHeaderSessionLinks />
          </div>
        </div>
      </header>

      <div className="calendar-layout">
        <div className="calendar-head">
          <div>
            <h1>Calendar</h1>
            <p>Camps, conventions, and ministry dates across Iowa and Missouri. <Link href="/events">See all events open for registration</Link>.</p>
          </div>
          <CalendarSubscribe links={buildSubscribeLinks(siteBaseUrl())} variant="button" />
        </div>

        <CalendarViewBar
          activeFilter={filter}
          chips={chips}
          currentView={view}
          nav={view === "year" ? {
            label: String(year),
            unit: "year",
            previous: { href: calendarHref({ view: "year", year: String(year - 1), filter, category }), label: String(year - 1) },
            next: { href: calendarHref({ view: "year", year: String(year + 1), filter, category }), label: String(year + 1) },
            todayHref: calendarHref({ view: "year", year: today.slice(0, 4), filter, category }),
          } : view === "month" ? {
            label: monthLabel(month),
            previous: { href: calendarHref({ ...base, month: monthKey(shiftMonth(month, -1)), date: undefined }), label: monthLabel(shiftMonth(month, -1)) },
            next: { href: calendarHref({ ...base, month: monthKey(shiftMonth(month, 1)), date: undefined }), label: monthLabel(shiftMonth(month, 1)) },
            todayHref: calendarHref({ view: "month", filter, category }),
          } : undefined}
          tabs={tabs}
        />

        {view === "month" && (
          <div className="calendar-board">
            <CalendarMotion category={`${filter}${category ? `:${category}` : ""}`} month={currentMonthKey} selectedDate={selectedDate ?? ""} />
            <div className="calendar-month" role="presentation">
              <div className="calendar-weekdays">
                {weekdays.map((weekday) => <div className="calendar-weekday" key={weekday}>{weekday}</div>)}
              </div>
              {grid.map((week, weekIndex) => {
                const { bars, hiddenByDay } = weekBarLayout(week, items, calendarGridRows);
                return (
                  <div className="calendar-week" key={week[0]}>
                    {week.map((date) => {
                      const dayItems = itemsOnDate(items, date);
                      const inMonth = date.slice(0, 7) === currentMonthKey;
                      return (
                        <div
                          id={`calendar-day-${date}`}
                          className={`calendar-day${inMonth ? "" : " is-outside"}${date === today ? " is-today" : ""}${dayItems.length ? " has-items" : ""}${date === selectedDate ? " is-selected" : ""}`}
                          key={date}
                        >
                          <CalendarDayLink
                            aria-current={date === selectedDate ? "true" : date === today ? "date" : undefined}
                            aria-label={`${formatWeekdayDate(date)}, ${calendarCountLabel(dayItems.length)}`}
                            className="calendar-day-link"
                            href={dayHrefFor(date)}
                          >
                            <span className="calendar-day-number">{Number(date.slice(8))}</span>
                          </CalendarDayLink>
                          {dayItems.length > 0 && (
                            <ul className="calendar-dots">
                              {dayItems.slice(0, 3).map((item) => (
                                <CalendarMonthChip
                                  className={`calendar-chip calendar-tone-${calendarItemTone(item, toneMap)} calendar-kind-${item.kind.toLowerCase()} calendar-status-${item.status.toLowerCase()}${item.isClosure ? " calendar-closure" : ""}`}
                                  item={item}
                                  key={item.key}
                                >
                                  {item.isClosure && <DoorClosed size={12} aria-hidden="true" />}
                                  {item.isClosure && <span className="sr-only">{closureLabel}: </span>}
                                  {item.title}
                                </CalendarMonthChip>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                    {bars.map((bar) => {
                      const { item } = bar;
                      const dates = formatDateRange(item.startsOn, item.endsOn);
                      return (
                        <CalendarDayLink
                          aria-label={`${item.isClosure ? `${closureLabel}: ` : ""}${item.title}, ${dates}${item.status !== "SCHEDULED" ? `, ${calendarStatusLabels[item.status]}` : ""}`}
                          className={`calendar-bar calendar-bar-row-${bar.row} calendar-tone-${calendarItemTone(item, toneMap)} calendar-status-${item.status.toLowerCase()}${bar.continuesBefore ? " continues-before" : ""}${bar.continuesAfter ? " continues-after" : ""}`}
                          data-calendar-key={item.key}
                          href={dayHrefFor(bar.segmentStart)}
                          key={item.key}
                          style={{ gridColumn: `${bar.startCol} / span ${bar.span}`, gridRow: bar.row + 2, "--cal-delay": `${calendarBarIntroDelay(weekIndex, bar.startCol, bar.row)}ms` } as CSSProperties}
                        >
                          {bar.continuesBefore && <span aria-hidden="true" className="calendar-bar-edge">‹</span>}
                          {item.isClosure && <DoorClosed size={14} aria-hidden="true" />}
                          <span className="calendar-bar-title">{item.title}</span>
                          {bar.span >= 3 && <span className="calendar-bar-dates">{dates}</span>}
                          {bar.continuesAfter && <span aria-hidden="true" className="calendar-bar-edge calendar-bar-edge-end">›</span>}
                        </CalendarDayLink>
                      );
                    })}
                    {hiddenByDay.map((hidden, index) => hidden > 0 && (
                      <CalendarDayLink
                        aria-label={`${hidden} more ${hidden === 1 ? "event" : "events"} on ${formatWeekdayDate(week[index])}`}
                        className="calendar-more-link"
                        href={dayHrefFor(week[index])}
                        key={`more-${week[index]}`}
                        style={{ gridColumn: index + 1, gridRow: 1 }}
                      >
                        {calendarMoreLabel(hidden)}
                      </CalendarDayLink>
                    ))}
                  </div>
                );
              })}
            </div>

            {selectedDate ? (
              <section aria-labelledby="calendar-day-heading" className="calendar-day-detail calendar-side" id="calendar-day-detail">
                <CalendarDayFocus key={selectedDate} />
                <h2 id="calendar-day-heading" tabIndex={-1}>Events on {formatLongDate(selectedDate)}</h2>
                <p className="calendar-day-count">
                  {selectedItems.length === 0
                    ? `No events on ${formatLongDate(selectedDate)} in ${filterLabel}${category ? ` (${category})` : ""}.`
                    : `${calendarCountLabel(selectedItems.length)} on ${formatLongDate(selectedDate)} in ${filterLabel}${category ? ` (${category})` : ""}.`}
                </p>
                {selectedItems.length > 0 && (
                  <ul className="calendar-panel-list" key={selectedDate}>{sortCalendarItems(selectedItems).map((item, index) => <CalendarPanelItem index={index} item={item} key={item.key} toneMap={toneMap} transitionName={panelNames.get(item.key)} />)}</ul>
                )}
                <div className="calendar-day-actions">
                  <Link className="secondary-button" href={calendarHref({ view: "month", month: monthKey(month), filter, category }, `calendar-day-${selectedDate}`)}>Show all of {monthName}</Link>
                  {filter !== "everything" && (
                    <Link className="text-button" href={calendarHref({ view: "month", month: monthKey(month), filter: "everything", date: selectedDate })}>Show everything</Link>
                  )}
                </div>
              </section>
            ) : (
              <section aria-labelledby="calendar-agenda-heading" className="calendar-month-list calendar-side" id="calendar-month-list">
                <h2 id="calendar-agenda-heading">In {monthLabel(month)}</h2>
                {monthItems.length === 0 ? (
                  <p className="calendar-empty">Nothing is on the calendar for {monthLabel(month)} in {filterLabel}{category ? ` (${category})` : ""}.</p>
                ) : (
                  <>
                    <p className="calendar-day-prompt">{calendarCountLabel(monthItems.length)}. Select a day to see only that day.</p>
                    <ul className="calendar-panel-list">
                      {previewItems.map((item, index) => <CalendarPanelItem index={index} item={item} key={item.key} toneMap={toneMap} transitionName={agendaNames.get(item.key)} />)}
                    </ul>
                    {moreItems.length > 0 && (
                      <details className="calendar-month-more">
                        <summary>Show {moreItems.length} more in {monthName}</summary>
                        <ul className="calendar-panel-list">
                          {moreItems.map((item, index) => <CalendarPanelItem index={index} item={item} key={item.key} toneMap={toneMap} transitionName={agendaNames.get(item.key)} />)}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </section>
            )}

            {keyEntries.length > 0 && (
              <ul aria-label="Colour key" className="calendar-key">
                {keyEntries.map((entry) => (
                  <li className={`calendar-key-item calendar-tone-${entry.tone}`} key={entry.label}><span aria-hidden="true" className="calendar-swatch" />{entry.label}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {calendarYear && (
          <CalendarYearView
            category={category}
            filter={filter}
            filterLabel={filterLabel}
            keyEntries={yearKeyEntries}
            previewCount={yearListPreview}
            selectedDate={selectedDate}
            selectedItems={selectedDate ? sortCalendarItems(itemsOnDate(items, selectedDate)) : []}
            today={today}
            toneMap={toneMap}
            year={calendarYear}
            yearItems={yearList}
          />
        )}

        {view === "list" && (
          <section aria-labelledby="calendar-agenda-heading" className="calendar-agenda">
            <h2 id="calendar-agenda-heading">Upcoming events</h2>
            {items.length === 0 ? (
              <p className="calendar-empty">Nothing is on the calendar yet in {filterLabel}{category ? ` (${category})` : ""}. Check back soon.</p>
            ) : (
              <>
              {featuredItems.length > 0 && (
                <div className="event-featured">
                  <h3 className="event-featured-heading" id="calendar-featured-heading">Featured</h3>
                  <ul aria-labelledby="calendar-featured-heading" className="event-featured-list">
                    {featuredItems.map((item) => (
                      <EventPhotoCard image={eventCardImage(item, featuredImages)} headingLevel={4} item={item} key={item.key} transitionName={featuredNames.get(item.key)} variant="featured" />
                    ))}
                  </ul>
                </div>
              )}
              {groupByMonth(listItems, today).map(([key, group]) => (
                <div className="calendar-agenda-group" key={key}>
                  <h3 className="calendar-agenda-month">{monthLabel(parseMonthParam(key, today))}</h3>
                  <ul className="calendar-agenda-list">{group.map((item) => <AgendaItem item={item} key={item.key} transitionName={agendaNames.get(item.key)} />)}</ul>
                </div>
              ))}
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

/** One colour-key line per tone the month's items use, in words: the category, "IMSDA event" for category-less events, "Office closed" for closures. */
function monthKeyEntries(monthItems: CalendarItem[], toneMap: Map<string, CalendarTone>) {
  const entries = new Map<string, { label: string; tone: CalendarTone }>();
  for (const item of monthItems) {
    const label = item.isClosure ? closureLabel : item.category.trim() || (item.kind === "EVENT" ? "IMSDA event" : "Conference date");
    if (!entries.has(label)) entries.set(label, { label, tone: calendarItemTone(item, toneMap) });
  }
  return [...entries.values()].sort((a, b) => a.label.localeCompare(b.label));
}
