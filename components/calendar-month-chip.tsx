"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { ItemLink } from "@/components/calendar-agenda-item";
import type { CalendarItem } from "@/modules/calendar/domain";

/** The month grid shrinks its chips to 7px dots at this width and below (app/globals.css). */
export const CALENDAR_DOT_QUERY = "(max-width: 760px)";

/**
 * What a month-grid chip and its link carry (#996). At dot size the link is clipped to a pixel, so it must also leave the tab order
 * and the accessibility tree: a keyboard user would otherwise tab onto a link they cannot see. The agenda under the grid lists the
 * same items with full-size links.
 */
export function calendarChipAccessibility(dots: boolean) {
  return dots
    ? { item: { "aria-hidden": true } as const, link: { tabIndex: -1 } as const }
    : { item: {} as const, link: {} as const };
}

function subscribe(onChange: () => void) {
  const list = window.matchMedia(CALENDAR_DOT_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** One chip in the month grid. */
export function CalendarMonthChip({ item, className, children }: { item: CalendarItem; className: string; children: ReactNode }) {
  const dots = useSyncExternalStore(subscribe, () => window.matchMedia(CALENDAR_DOT_QUERY).matches, () => false);
  const access = calendarChipAccessibility(dots);
  return (
    <li className={className} {...access.item}>
      <ItemLink item={item} {...access.link}>{children}</ItemLink>
    </li>
  );
}
