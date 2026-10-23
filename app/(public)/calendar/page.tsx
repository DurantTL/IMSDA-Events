import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, DoorClosed, List } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { CalendarSubscribe } from "@/components/calendar-subscribe";
import { AgendaItem } from "@/components/calendar-agenda-item";
import { CalendarDayFocus } from "@/components/calendar-day-focus";
import { CalendarMonthChip } from "@/components/calendar-month-chip";
import {
  calendarCategories,
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
  parseDateParam,
  formatLongDate,
  calendarCountLabel,
  sortCalendarItems,
  shiftMonth,
  addDays,
  type CalendarItem,
} from "@/modules/calendar/domain";
import { conferenceToday, listPublicCalendarItems } from "@/modules/calendar/repository";
import { buildSubscribeLinks, siteBaseUrl } from "@/modules/calendar/subscribe";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conference calendar",
  description: "Upcoming Iowa-Missouri Conference events, camps, and ministry dates.",
  alternates: { canonical: "/calendar" },
  robots: { index: true, follow: true },
};

type SearchParams = Promise<{ view?: string; month?: string; category?: string; date?: string }>;

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function calendarHref(params: { view?: string; month?: string; category?: string; date?: string }, hash?: string) {
  const search = new URLSearchParams();
  if (params.view && params.view !== "month") search.set("view", params.view);
  if (params.month) search.set("month", params.month);
  if (params.category) search.set("category", params.category);
  if (params.date) search.set("date", params.date);
  const query = search.toString();
  return `${query ? `/calendar?${query}` : "/calendar"}${hash ? `#${hash}` : ""}`;
}

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
  const view = params.view === "list" ? "list" : "month";
  const category = params.category?.slice(0, 40) || undefined;
  const today = conferenceToday();
  // A selected date (month view only) opens that date's complete agenda and decides the month shown, so an adjacent-month
  // date from the grid lands on its own month instead of a list that excludes it.
  const selectedDate = view === "month" ? parseDateParam(params.date, today) : undefined;
  const month = parseMonthParam(selectedDate ? selectedDate.slice(0, 7) : params.month, today);

  const grid = monthGrid(month);
  const from = view === "month" ? grid[0][0] : today;
  const to = view === "month" ? grid[grid.length - 1][6] : addDays(today, 365);
  const allItems = await listPublicCalendarItems(from, to);
  const categories = calendarCategories(allItems);
  if (category && !categories.some((name) => name.toLowerCase() === category.toLowerCase())) categories.push(category);
  const items = filterByCategory(allItems, category);
  const monthItems = itemsOverlapping(items, firstOfMonth(month), lastOfMonth(month));
  const currentMonthKey = monthKey(month);
  const base = { view, month: view === "month" ? params.month : undefined, category };
  const selectedItems = selectedDate ? itemsOnDate(items, selectedDate) : [];

  return (
    <main className="public-registration-page public-calendar-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <Link className="public-registration-brand public-event-brand-link" href="/">
            <BrandMark />
            <span><strong>IMSDA</strong><small>Events</small></span>
          </Link>
          <div className="public-header-links">
            <a className="text-button calendar-subscribe" href="#subscribe" aria-label="Subscribe to the calendar">
              <CalendarPlus size={16} aria-hidden="true" /> <span>Subscribe</span>
            </a>
            <PublicHeaderSessionLinks />
          </div>
        </div>
      </header>

      <section className="public-registration-hero calendar-hero">
        <div>
          <p className="public-registration-eyebrow">Iowa-Missouri Conference</p>
          <h1>Conference calendar</h1>
          <p>Camps, conventions, and ministry dates across Iowa and Missouri.</p>
        </div>
      </section>

      <div className="calendar-layout">
        <div className="calendar-toolbar">
          <nav aria-label="Calendar view" className="calendar-view-toggle">
            <Link aria-current={view === "month" ? "page" : undefined} href={calendarHref({ ...base, view: "month" })}>
              <CalendarDays size={15} aria-hidden="true" /> Month
            </Link>
            <Link aria-current={view === "list" ? "page" : undefined} href={calendarHref({ view: "list", category })}>
              <List size={15} aria-hidden="true" /> Upcoming
            </Link>
          </nav>
          {view === "month" && (
            <div className="calendar-month-nav">
              <Link aria-label={`Previous month, ${monthLabel(shiftMonth(month, -1))}`} className="secondary-button" href={calendarHref({ ...base, month: monthKey(shiftMonth(month, -1)) })}>
                <ChevronLeft size={16} aria-hidden="true" />
              </Link>
              <h2 aria-live="polite">{monthLabel(month)}</h2>
              <Link aria-label={`Next month, ${monthLabel(shiftMonth(month, 1))}`} className="secondary-button" href={calendarHref({ ...base, month: monthKey(shiftMonth(month, 1)) })}>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
              {currentMonthKey !== today.slice(0, 7) && (
                <Link className="text-button" href={calendarHref({ ...base, month: undefined })}>Today</Link>
              )}
            </div>
          )}
        </div>

        {categories.length > 0 && (
          <nav aria-label="Filter by category" className="calendar-categories">
            <Link aria-current={!category ? "page" : undefined} href={calendarHref({ ...base, category: undefined, date: selectedDate })}>All</Link>
            {categories.map((name) => (
              <Link
                aria-current={category?.toLowerCase() === name.toLowerCase() ? "page" : undefined}
                href={calendarHref({ ...base, category: name, date: selectedDate })}
                key={name}
              >
                {name}
              </Link>
            ))}
          </nav>
        )}

        {view === "month" && (
          <div className="calendar-month" role="presentation">
            {weekdays.map((weekday) => <div className="calendar-weekday" key={weekday}>{weekday}</div>)}
            {grid.flat().map((date) => {
              const dayItems = itemsOnDate(items, date);
              const inMonth = date.slice(0, 7) === currentMonthKey;
              const dayLabel = `${formatLongDate(date)}, ${calendarCountLabel(dayItems.length)}`;
              const dayHref = calendarHref(
                { view: "month", month: inMonth ? (selectedDate ? monthKey(month) : params.month) : date.slice(0, 7), category, date },
                "calendar-day-detail",
              );
              return (
                <div
                  id={`calendar-day-${date}`}
                  className={`calendar-day${inMonth ? "" : " is-outside"}${date === today ? " is-today" : ""}${dayItems.length ? " has-items" : ""}${date === selectedDate ? " is-selected" : ""}`}
                  key={date}
                >
                  {dayItems.length > 0 ? (
                    <Link aria-current={date === selectedDate ? "date" : undefined} aria-label={`${dayLabel}. View all`} className="calendar-day-number calendar-day-link" href={dayHref}>
                      {Number(date.slice(8))}
                    </Link>
                  ) : (
                    <span className="calendar-day-number">{Number(date.slice(8))}</span>
                  )}
                  {dayItems.length > 0 && (
                    <ul>
                      {dayItems.slice(0, 3).map((item) => (
                        <CalendarMonthChip
                          className={`calendar-chip calendar-kind-${item.kind.toLowerCase()} calendar-status-${item.status.toLowerCase()}${item.isClosure ? " calendar-closure" : ""}`}
                          item={item}
                          key={item.key}
                        >
                          {item.isClosure && <DoorClosed size={12} aria-hidden="true" />}
                          {item.isClosure && <span className="sr-only">{closureLabel}: </span>}
                          {item.title}
                        </CalendarMonthChip>
                      ))}
                      {dayItems.length > 3 && (
                        <li className="calendar-more">
                          <Link className="calendar-more-link" href={dayHref}>
                            View all {dayItems.length}<span className="sr-only"> events for {formatLongDate(date)}</span>
                          </Link>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {view === "month" && selectedDate && (
          <section aria-labelledby="calendar-day-heading" className="calendar-day-detail" id="calendar-day-detail">
            <CalendarDayFocus key={`${selectedDate}|${category ?? ""}`} />
            <h2 id="calendar-day-heading" tabIndex={-1}>Events on {formatLongDate(selectedDate)}</h2>
            <p className="calendar-day-count" role="status">
              {selectedItems.length === 0
                ? `No events on ${formatLongDate(selectedDate)}${category ? ` in ${category}` : ""}.`
                : `${calendarCountLabel(selectedItems.length)} on ${formatLongDate(selectedDate)}${category ? ` in ${category}` : ""}.`}
            </p>
            {selectedItems.length > 0 && (
              <ul className="calendar-agenda-list">{sortCalendarItems(selectedItems).map((item) => <AgendaItem item={item} key={item.key} />)}</ul>
            )}
            <div className="calendar-day-actions">
              <Link className="secondary-button" href={calendarHref({ view: "month", month: monthKey(month), category }, `calendar-day-${selectedDate}`)}>Back to {monthLabel(month)}</Link>
              <a className="text-button" href="#calendar-agenda-heading">Month agenda</a>
              {category && (
                <Link className="text-button" href={calendarHref({ view: "month", month: monthKey(month), date: selectedDate })}>Clear category ({category})</Link>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby="calendar-agenda-heading" className="calendar-agenda">
          <h2 className={view === "month" ? "sr-only" : undefined} id="calendar-agenda-heading">
            {view === "month" ? `Events in ${monthLabel(month)}` : "Upcoming events"}
          </h2>
          {view === "month" ? (
            monthItems.length === 0 ? (
              <p className="calendar-empty">Nothing is on the calendar for {monthLabel(month)}{category ? ` in ${category}` : ""}.</p>
            ) : (
              <ul className="calendar-agenda-list">{monthItems.map((item) => <AgendaItem item={item} key={item.key} />)}</ul>
            )
          ) : items.length === 0 ? (
            <p className="calendar-empty">Nothing is on the calendar yet{category ? ` in ${category}` : ""}. Check back soon.</p>
          ) : (
            groupByMonth(firstPerSeries(items), today).map(([key, group]) => (
              <div className="calendar-agenda-group" key={key}>
                <h3 className="calendar-agenda-month">{monthLabel(parseMonthParam(key, today))}</h3>
                <ul className="calendar-agenda-list">{group.map((item) => <AgendaItem item={item} key={item.key} />)}</ul>
              </div>
            ))
          )}
        </section>

        <CalendarSubscribe links={buildSubscribeLinks(siteBaseUrl())} />
      </div>
    </main>
  );
}
