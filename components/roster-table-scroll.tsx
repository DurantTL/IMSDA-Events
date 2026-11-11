"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import styles from "@/components/club-roster-table.module.css";

/** A desktop window with a mouse, where the roster stays a table (#1838). Keep in step with club-roster-table.module.css. */
export const ROSTER_DESKTOP_TABLE_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 1024px)";
/** The widest box that shows the shared cards (table-cards-xwide, `@container table-box (max-width: 1100px)`). */
const CARD_BOX_MAX = 1100;

/**
 * The wrap around a roster table (#1757). On a desktop window the roster is a table (#1838); when that table is wider than its
 * card (extra columns such as Show gender, Show school details and Show baptized, or a narrow window), the wrap is marked
 * `data-fit="cards"` and shows the same cards a tablet gets, so nothing scrolls sideways (#1861). It goes back to the table once
 * the card is as wide as the table needed, or wider than the cards' 1100px limit. Elsewhere a table wider than its card still
 * scrolls inside the wrap; a box that scrolls is a keyboard stop with a name (arrow keys scroll it); a box that fits, and the
 * card layout, are not.
 */
export function RosterTableScroll({ children, label, fitKey }: { children?: ReactNode; label: string; fitKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const wrap = ref.current;
    if (!wrap) return;
    const desktop = typeof window.matchMedia === "function" ? window.matchMedia(ROSTER_DESKTOP_TABLE_QUERY) : null;
    const overflows = () => wrap.scrollWidth > wrap.clientWidth + 1;
    // A wider box never shows cards, so there the table keeps scrolling inside the wrap.
    const cardsFit = () => {
      const style = getComputedStyle(wrap);
      return wrap.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0") <= CARD_BOX_MAX;
    };
    // The width the table needed when it last did not fit; the cards stay until the card is at least that wide.
    let needed = 0;
    const measure = () => {
      if (wrap.dataset.fit === "cards" && (!desktop?.matches || wrap.clientWidth >= needed || !cardsFit())) delete wrap.dataset.fit;
      if (desktop?.matches && wrap.dataset.fit !== "cards" && overflows() && cardsFit()) {
        needed = wrap.scrollWidth;
        wrap.dataset.fit = "cards";
      }
      setScrolls(overflows());
    };
    // New columns: try the table again.
    delete wrap.dataset.fit;
    measure();
    desktop?.addEventListener?.("change", measure);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(wrap);
      const table = wrap.querySelector("table");
      if (table) observer.observe(table);
    }
    return () => {
      observer?.disconnect();
      desktop?.removeEventListener?.("change", measure);
    };
  }, [fitKey]);
  return (
    <div
      aria-label={scrolls ? label : undefined}
      className={`report-table-wrap ${styles.rosterTableWrap}`}
      ref={ref}
      role={scrolls ? "region" : undefined}
      tabIndex={scrolls ? 0 : undefined}
    >
      {children}
    </div>
  );
}
