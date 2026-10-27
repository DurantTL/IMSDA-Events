import Link from "next/link";
import { CalendarDayFocus } from "@/components/calendar-day-focus";
import { CalendarDayLink } from "@/components/calendar-day-link";
import { CalendarPanelItem } from "@/components/calendar-panel-item";
import { calendarItemCountLabel, formatLongDate, formatWeekdayDate, type CalendarItem, type CalendarTone } from "@/modules/calendar/domain";
import { calendarHref } from "@/modules/calendar/calendar-href";
import type { CalendarYear, YearDay, YearMark, YearMonth } from "@/modules/calendar/year";

const weekdayLetters = ["S", "M", "T", "W", "T", "F", "S"];

/** The phone rows list this many item names before "and N more". */
const rowNames = 3;

function markClass(mark: YearMark) {
  if (mark.shape === "overflow") return "calendar-year-mark is-overflow";
  const parts = [`calendar-year-mark calendar-tone-${mark.tone}`, mark.shape === "dot" ? "is-dot" : `is-bar is-${mark.part}`];
  if (mark.isClosure) parts.push("is-closure");
  if (mark.continuesBefore) parts.push("continues-before");
  if (mark.continuesAfter) parts.push("continues-after");
  return parts.join(" ");
}

function Marks({ day }: { day: YearDay }) {
  if (day.marks.length === 0) return null;
  return (
    <span aria-hidden="true" className="calendar-year-marks">
      {([0, 1] as const).map((lane) => {
        const mark = day.marks.find((candidate) => candidate.lane === lane);
        return mark ? <span className={markClass(mark)} key={lane} /> : <span className="calendar-year-mark is-empty" key={lane} />;
      })}
    </span>
  );
}

/**
 * The Year view (#1250): twelve mini months beside a side panel on a wide screen, twelve one-link rows on a phone. Both are
 * rendered on the server and CSS hides one of them. Only a day with items is a link (to that day's items in the side panel);
 * the other days are plain text and cannot take focus.
 */
export function CalendarYearView({
  year,
  yearItems,
  selectedDate,
  selectedItems,
  filter,
  filterLabel,
  category,
  today,
  toneMap,
  previewCount,
  keyEntries,
}: {
  year: CalendarYear;
  /** The year's items in the chosen filter, a repeating series once. */
  yearItems: CalendarItem[];
  selectedDate?: string;
  selectedItems: CalendarItem[];
  filter: string;
  filterLabel: string;
  category?: string;
  today: string;
  toneMap: Map<string, CalendarTone>;
  previewCount: number;
  keyEntries: { label: string; tone: CalendarTone }[];
}) {
  const scope = `${filterLabel}${category ? ` (${category})` : ""}`;
  const dayHref = (date: string) => calendarHref({ view: "year", year: String(year.year), filter, category, date }, "calendar-year-detail");
  const monthHref = (month: YearMonth, hash?: string) => calendarHref({ view: "month", month: month.key, filter, category }, hash);
  const preview = yearItems.slice(0, previewCount);
  const rest = yearItems.slice(previewCount);
  return (
    <div className="calendar-board calendar-year-board">
      <div className="calendar-year-grid">
        {year.months.map((month) => (
          <div className="calendar-year-month" key={month.key}>
            <h3>
              <Link href={monthHref(month)}>
                {month.name}<span className="sr-only"> {month.year}, open the month view</span>
              </Link>
            </h3>
            <div aria-hidden="true" className="calendar-year-weekdays">
              {weekdayLetters.map((letter, index) => <span key={index}>{letter}</span>)}
            </div>
            {month.weeks.map((week, weekIndex) => (
              <div className="calendar-year-week" key={weekIndex}>
                {week.map((day, cellIndex) => {
                  if (!day) return <span className="calendar-year-day is-blank" key={cellIndex} />;
                  const classes = `calendar-year-day${day.isSabbath ? " is-sabbath" : ""}${day.date === today ? " is-today" : ""}${day.date === selectedDate ? " is-selected" : ""}`;
                  if (day.count === 0) {
                    return (
                      <span className={classes} key={day.date}>
                        <span className="calendar-year-number">{day.day}{day.date === today && <span className="sr-only"> (today)</span>}</span>
                      </span>
                    );
                  }
                  return (
                    <CalendarDayLink
                      aria-current={day.date === selectedDate ? "true" : day.date === today ? "date" : undefined}
                      aria-label={`${formatWeekdayDate(day.date)}, ${calendarItemCountLabel(day.count)}`}
                      className={`${classes} has-items`}
                      href={dayHref(day.date)}
                      key={day.date}
                    >
                      <span className="calendar-year-number">{day.day}</span>
                      <Marks day={day} />
                    </CalendarDayLink>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      <ol className="calendar-year-rows">
        {year.months.map((month) => {
          const names = month.items.slice(0, rowNames);
          const more = month.items.length - names.length;
          return (
            <li key={month.key}>
              <Link aria-label={`${month.label}, ${calendarItemCountLabel(month.items.length)}`} className="calendar-year-row" href={monthHref(month, "calendar-month-list")}>
                <span className="calendar-year-row-name">{month.name}</span>
                <span aria-hidden="true" className="calendar-year-strip">
                  {month.days.map((day) => {
                    const mark = day.marks[0];
                    const tone = mark && mark.shape !== "overflow" ? ` calendar-tone-${mark.tone}${mark.isClosure ? " is-closure" : ""}` : "";
                    return <span className={`calendar-year-slot${day.isSabbath ? " is-sabbath" : ""}${mark ? " has-mark" : ""}${mark?.shape === "overflow" ? " is-overflow" : ""}${tone}`} key={day.date} />;
                  })}
                </span>
                <span className="calendar-year-row-items">
                  {names.length === 0 && <span className="calendar-year-row-none">Nothing in {filterLabel}</span>}
                  {names.map((item) => <span key={item.key}>{item.title}</span>)}
                  {more > 0 && <span className="calendar-year-row-more">and {more} more</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      {selectedDate ? (
        <section aria-labelledby="calendar-day-heading" className="calendar-day-detail calendar-side" id="calendar-year-detail">
          <CalendarDayFocus key={selectedDate} />
          <h2 id="calendar-day-heading" tabIndex={-1}>Events on {formatLongDate(selectedDate)}</h2>
          <p className="calendar-day-count">
            {selectedItems.length === 0
              ? `Nothing on ${formatLongDate(selectedDate)} in ${scope}.`
              : `${calendarItemCountLabel(selectedItems.length)} on ${formatLongDate(selectedDate)} in ${scope}.`}
          </p>
          {selectedItems.length > 0 && (
            <ul className="calendar-panel-list" key={selectedDate}>
              {selectedItems.map((item, index) => <CalendarPanelItem index={index} item={item} key={item.key} toneMap={toneMap} />)}
            </ul>
          )}
          <div className="calendar-day-actions">
            <Link className="secondary-button" href={calendarHref({ view: "year", year: String(year.year), filter, category }, "calendar-year-detail")}>Back to the year&apos;s list</Link>
            {filter !== "everything" && (
              <Link className="text-button" href={calendarHref({ view: "year", year: String(year.year), filter: "everything", date: selectedDate }, "calendar-year-detail")}>Show everything</Link>
            )}
          </div>
        </section>
      ) : (
        <section aria-labelledby="calendar-year-heading" className="calendar-month-list calendar-side" id="calendar-year-detail">
          <h2 id="calendar-year-heading">In {year.year}</h2>
          {yearItems.length === 0 ? (
            <p className="calendar-empty">Nothing is on the calendar for {year.year} in {scope}.</p>
          ) : (
            <>
              <p className="calendar-day-prompt">{calendarItemCountLabel(yearItems.length)} in {scope}. Select a marked day to see only that day.</p>
              <ul className="calendar-panel-list">
                {preview.map((item, index) => <CalendarPanelItem index={index} item={item} key={item.key} toneMap={toneMap} />)}
              </ul>
              {rest.length > 0 && (
                <details className="calendar-month-more">
                  <summary>Show all {yearItems.length} in the list</summary>
                  <ul className="calendar-panel-list">
                    {rest.map((item, index) => <CalendarPanelItem index={index} item={item} key={item.key} toneMap={toneMap} />)}
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
  );
}

