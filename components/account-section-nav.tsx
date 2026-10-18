"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useLayoutEffect, useRef } from "react";

export type AccountNavItem = {
  href: string;
  label: string;
  /** Also active on pages below this one (e.g. every club screen for "My clubs"). */
  matchChildren?: boolean;
  /** Another section this tab owns, itself and anything below it (e.g. Area Coordinator club pages under "Clubs", or a club's export page under its tab). */
  alsoMatchPrefix?: string;
  /** A heading shown before the first item of each run of items sharing it (e.g. "People"). Items without one sit ungrouped. */
  group?: string;
  /**
   * Leave the group's heading off the screen (the list keeps the name for
   * assistive tech). Set it when the group's own tab already says it, e.g.
   * "Events" above an "Events" tab: a scrolling row can't spare the width.
   */
  hideGroupLabel?: boolean;
};

/** Room kept clear on a scrolled edge of the tab row for its arrow button and fade (px); the CSS scroll-padding matches it. */
const SCROLL_CLEARANCE = 46;

export function isAccountNavItemActive(pathname: string, item: AccountNavItem) {
  if (pathname === item.href) return true;
  if (item.alsoMatchPrefix && pathname.startsWith(item.alsoMatchPrefix)) return true;
  return Boolean(item.matchChildren) && pathname.startsWith(`${item.href}/`);
}

/**
 * Tabs across the attendee and club-director pages. On a phone the row
 * scrolls sideways and keeps the current tab in view instead of wrapping into
 * a tall stack of buttons.
 */
export function AccountSectionNav({
  items,
  label,
  variant = "primary",
}: {
  items: AccountNavItem[];
  label: string;
  variant?: "primary" | "secondary";
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Open with the current tab centred in the row (the row scrolls sideways on
  // a phone) before the first paint, then keep the edge fades in step with how
  // far the row is scrolled. Only the row itself scrolls: scrollIntoView could
  // also move the page.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const list = listRef.current;
    if (!nav || !list) return;
    const current = list.querySelector<HTMLElement>("[aria-current=page]");
    if (current) {
      const listBox = list.getBoundingClientRect();
      const currentBox = current.getBoundingClientRect();
      const offset = currentBox.left - listBox.left + list.scrollLeft;
      const centred = Math.max(0, offset - (list.clientWidth - currentBox.width) / 2);
      // Open the row on a tab's own edge, never partway through a word (#997), with the current tab whole and clear of the
      // scroll arrows and fades on each side that has more tabs beyond it. Only tab edges (and the very start) are candidates.
      const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
      const stops = Array.from(list.children).map((child) => child.getBoundingClientRect().left - listBox.left + list.scrollLeft);
      const candidates = [0, ...stops.map((stop) => stop - SCROLL_CLEARANCE)]
        .map((position) => Math.min(Math.max(0, position), maxScroll));
      const clear = (position: number) => {
        const left = position > 1 ? SCROLL_CLEARANCE : 0;
        const right = position + list.clientWidth < list.scrollWidth - 1 ? SCROLL_CLEARANCE : 0;
        return offset >= position + left - 1 && offset + currentBox.width <= position + list.clientWidth - right + 1;
      };
      const wholeEdge = (position: number) => position === 0 || position === maxScroll || stops.some((stop) => Math.abs(stop - SCROLL_CLEARANCE - position) < 1);
      const best = candidates
        .filter((position) => clear(position) && wholeEdge(position))
        .sort((x, y) => Math.abs(x - centred) - Math.abs(y - centred))[0];
      list.scrollLeft = best ?? Math.min(maxScroll, Math.max(0, offset - SCROLL_CLEARANCE));
    }
    const setFade = (name: "fadeStart" | "fadeEnd", on: boolean) => {
      const value = String(on);
      if (nav.dataset[name] !== value) nav.dataset[name] = value;
    };
    const updateFades = () => {
      setFade("fadeStart", list.scrollLeft > 1);
      setFade("fadeEnd", list.scrollLeft + list.clientWidth < list.scrollWidth - 1);
    };
    updateFades();
    list.addEventListener("scroll", updateFades, { passive: true });
    // The row's width changes without it resizing when the tabs reflow (web fonts
    // arriving, a tab label changing), so watch the tabs too and re-check once
    // fonts are ready.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateFades);
    if (observer) {
      observer.observe(list);
      for (const child of Array.from(list.children)) observer.observe(child);
    }
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) updateFades();
    });
    return () => {
      cancelled = true;
      list.removeEventListener("scroll", updateFades);
      observer?.disconnect();
    };
  }, [pathname, items]);

  // The arrows scroll the row by most of its width; the row then snaps to a tab edge.
  const scrollTabs = (direction: 1 | -1) => {
    const list = listRef.current;
    if (!list) return;
    const smooth = typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollBy({ left: direction * Math.max(120, list.clientWidth - 2 * SCROLL_CLEARANCE), behavior: smooth ? "smooth" : "auto" });
  };

  const groupIdBase = useId();
  // Consecutive items sharing a group become one section; ungrouped items stay top level.
  const sections: Array<{ group?: string; items: AccountNavItem[] }> = [];
  for (const item of items) {
    const last = sections[sections.length - 1];
    if (last && last.group === item.group && item.group) last.items.push(item);
    else sections.push({ group: item.group, items: [item] });
  }
  const renderItem = (item: AccountNavItem) => (
    <li key={item.href}>
      <Link aria-current={isAccountNavItemActive(pathname, item) ? "page" : undefined} href={item.href}>
        {item.label}
      </Link>
    </li>
  );

  return (
    <nav aria-label={label} className={`account-nav account-nav-${variant}`} ref={navRef}>
      <button
        aria-label="Scroll tabs left"
        className="account-nav-arrow account-nav-arrow-start"
        onClick={() => scrollTabs(-1)}
        title="Scroll tabs left"
        type="button"
      ><span aria-hidden="true">{"\u2039"}</span></button>
      <ul ref={listRef}>
        {sections.map((section, index) =>
          section.group ? (
            <li className="account-nav-group" key={`${section.group}-${index}`}>
              {section.items.some((item) => item.hideGroupLabel)
                ? <ul aria-label={section.group}>{section.items.map(renderItem)}</ul>
                : (
                  <>
                    <span className="account-nav-group-label" id={`${groupIdBase}-${index}`}>{section.group}</span>
                    <ul aria-labelledby={`${groupIdBase}-${index}`}>{section.items.map(renderItem)}</ul>
                  </>
                )}
            </li>
          ) : (
            section.items.map(renderItem)
          ),
        )}
      </ul>
      <button
        aria-label="Scroll tabs right"
        className="account-nav-arrow account-nav-arrow-end"
        onClick={() => scrollTabs(1)}
        title="Scroll tabs right"
        type="button"
      ><span aria-hidden="true">{"\u203A"}</span></button>
    </nav>
  );
}
