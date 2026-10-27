import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarChipScroll } from "@/components/calendar-chip-scroll";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type CalendarViewTab = { key: string; label: string; href: string; icon?: ReactNode };
export type CalendarFilterChip = { slug: string; label: string; href: string };
export type CalendarBarNav = {
  /** "March 2026", or "2027" for the Year view. */
  label: string;
  /** What the arrows step by; Month unless the Year view says otherwise. */
  unit?: "month" | "year";
  previous: { href: string; label: string };
  next: { href: string; label: string };
  todayHref: string;
};

/**
 * The calendar's sticky bar (#1249): the view tabs, the month navigation and the filter chips. The tabs come in as a list, so the
 * Year view (#1250) is one more entry and nothing else moves. The navigation steps by month, or by year in the Year view (#1250), and is left out for views with neither.
 * Links only, no buttons, so it never counts as an action bar that covers text.
 */
export function CalendarViewBar({
  tabs,
  currentView,
  nav,
  chips,
  activeFilter,
}: {
  tabs: CalendarViewTab[];
  currentView: string;
  nav?: CalendarBarNav;
  chips: CalendarFilterChip[];
  activeFilter: string;
}) {
  return (
    <div className="calendar-sticky-bar">
      <div className="calendar-toolbar">
        <nav aria-label="Calendar view" className="calendar-view-toggle">
          {tabs.map((tab) => (
            <Link aria-current={tab.key === currentView ? "page" : undefined} href={tab.href} key={tab.key}>
              {tab.icon} {tab.label}
            </Link>
          ))}
        </nav>
        {nav && (
          <div aria-label={nav.unit === "year" ? "Year" : "Month"} className="calendar-month-nav" role="group">
            <Link aria-label={`Previous ${nav.unit ?? "month"}, ${nav.previous.label}`} className="secondary-button" href={nav.previous.href}>
              <ChevronLeft size={16} aria-hidden="true" />
            </Link>
            <h2 aria-live="polite">{nav.label}</h2>
            <Link aria-label={`Next ${nav.unit ?? "month"}, ${nav.next.label}`} className="secondary-button" href={nav.next.href}>
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
            <Link className="text-button calendar-today-link" href={nav.todayHref}>{nav.unit === "year" ? "This year" : "Today"}</Link>
          </div>
        )}
      </div>
      <nav aria-label="Filter events" className="calendar-categories">
        {chips.map((chip) => (
          <Link aria-current={chip.slug === activeFilter ? "page" : undefined} href={chip.href} key={chip.slug}>{chip.label}</Link>
        ))}
        <CalendarChipScroll active={activeFilter} />
      </nav>
    </div>
  );
}
