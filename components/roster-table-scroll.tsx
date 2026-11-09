"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import styles from "@/components/club-roster-table.module.css";

/**
 * The wrap around a roster table (#1757). When every optional column is on, the table can be wider than its card; the wrap then
 * scrolls sideways inside the card instead of letting the table spill past it. A box that scrolls is a keyboard stop with a name
 * (arrow keys scroll it); a box that fits, and the phone card layout, are not.
 */
export function RosterTableScroll({ children, label }: { children?: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const wrap = ref.current;
    if (!wrap) return;
    const measure = () => setScrolls(wrap.scrollWidth > wrap.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    const table = wrap.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, []);
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
