/** Pure helpers for the public calendar's motion (#1206). Kept free of the DOM so they can be unit tested. */

export const CALENDAR_SELECTION_STORAGE = "calendar-selected-event";
export const CALENDAR_INTRO_ATTRIBUTE = "data-calendar-intro-done";
/** How long the first-load intro (bar draw-in and today pulse) runs before it is switched off for the rest of the visit. */
export const CALENDAR_INTRO_MS = 1000;
export const CALENDAR_SLIDE_MS = 350;

/** The way the month slides when the visitor moves between two "YYYY-MM" keys; null for no change or no earlier month. */
export function calendarSlideDirection(previous: string | null | undefined, next: string): "next" | "prev" | null {
  if (!previous || previous === next) return null;
  return next > previous ? "next" : "prev";
}

/** Draw-in delay in ms for a bar: later weeks, columns and rows start later, so the whole intro ends within about 0.6s. */
export function calendarBarIntroDelay(weekIndex: number, startCol: number, row: number) {
  return Math.min(weekIndex * 50 + Math.max(startCol - 1, 0) * 25 + row * 25, 400);
}

/** Every element that stands for the same event shares one key; returns the elements carrying `key` (all weeks, chips included). */
export function elementsForKey<T extends { dataset: Record<string, string | undefined> }>(elements: Iterable<T>, key: string): T[] {
  return [...elements].filter((element) => element.dataset.calendarKey === key);
}

export type CalendarSelection = { key: string; date: string };

export function serializeCalendarSelection(selection: CalendarSelection) {
  return JSON.stringify(selection);
}

export function parseCalendarSelection(raw: string | null | undefined): CalendarSelection | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CalendarSelection>;
    return typeof value.key === "string" && value.key && typeof value.date === "string" ? { key: value.key, date: value.date } : null;
  } catch {
    return null;
  }
}

/** A clicked event stays selected only while the day panel it opened is the one showing. */
export function calendarSelectedKey(selection: CalendarSelection | null, selectedDate: string | null | undefined) {
  return selection && selectedDate && selection.date === selectedDate ? selection.key : null;
}

/** The date a day link opens, read from its href. */
export function calendarDateFromHref(href: string | null | undefined) {
  if (!href) return null;
  const match = /[?&]date=(\d{4}-\d{2}-\d{2})/.exec(href);
  return match ? match[1] : null;
}

/** Identity of a bar (one per week it spans) or chip (one per day) for the category FLIP. */
export function calendarFlipId(kind: "bar" | "chip", key: string, scope: string) {
  return `${kind}:${key}:${scope}`;
}

export type CalendarRect = { left: number; top: number; width: number; height: number };

/** The offset that puts an element at its old position, or null when it did not move. */
export function calendarFlipDelta(before: CalendarRect, after: CalendarRect) {
  const dx = before.left - after.left;
  const dy = before.top - after.top;
  return Math.abs(dx) < 1 && Math.abs(dy) < 1 ? null : { dx, dy };
}
