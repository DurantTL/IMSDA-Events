"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { GuardedLink } from "@/components/guarded-link";
import { StaffMenuDialog } from "@/components/staff-menu-dialog";
import { usePathname } from "next/navigation";
import { tabCurrent, type RowTab } from "@/components/staff-tab-row-model";
import styles from "./staff-shell.module.css";

const rowFitsQuery = "(min-width: 1024px)";

/**
 * The one row of tabs of the current area or event (#1565), and its menu line. Both are in the page: below 1024px the
 * stylesheet shows the menu line (the current tab and "<Area> menu"), and above it a ResizeObserver compares the
 * row's natural width with the room it has and sets `data-fit="tight"` when it would not fit, which shows the same menu line.
 * A row never scrolls sideways or is cut off. The links are guarded: an unsaved form asks first.
 */
export function StaffTabRow({
  label,
  menuLabel,
  title,
  tabs,
  trailing,
}: {
  /** The row's accessible name: the area ("Clubs") or the event. */
  label: string;
  /** The menu line's button: "Event menu" or "Clubs menu". */
  menuLabel: string;
  /** The menu dialog's heading. */
  title: string;
  tabs: readonly RowTab[];
  trailing?: ReactNode;
}) {
  const pathname = usePathname();
  const lineRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [tight, setTight] = useState(false);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const current = tabs.find((tab) => tab.current) ?? tabs[0];

  useEffect(() => {
    const line = lineRef.current;
    const list = listRef.current;
    if (!line || !list) return;
    const wide = window.matchMedia(rowFitsQuery);
    function measure() {
      if (!line || !list) return;
      // Below 1024px the stylesheet already shows the menu line; there is nothing to measure.
      if (!wide.matches) return;
      // The trailing control (the club year, the event opener) wraps to its own line when it does not fit beside the tabs, so
      // the tabs may use the whole line: only the row's own width decides between tabs and the menu line.
      const room = line.clientWidth;
      setTight(list.getBoundingClientRect().width > room);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    wide.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", measure);
    };
  }, [tabs]);

  if (tabs.length === 0) return null;
  return (
    <div className={styles.tabline} ref={lineRef} data-staff-tabs data-fit={tight ? "tight" : "ok"}>
      <nav className={styles.tabs} aria-label={label}>
        <ul ref={listRef}>
          {tabs.map((tab) => (
            <li key={tab.key}>
              <GuardedLink href={tab.href} aria-current={tabCurrent(tab, pathname)}>
                {tab.label}
                {tab.count ? <span className="count-badge"><span aria-hidden="true">{tab.count > 99 ? "99+" : tab.count}</span><span className="sr-only"> {tab.count} waiting</span></span> : null}
              </GuardedLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.menuline} data-staff-menu-line>
        <span className={styles.current}>{current.label}{current.count ? <span className="count-badge">{current.count}</span> : null}</span>
        <button
          ref={buttonRef}
          type="button"
          className={`secondary-button ${styles.menuButton}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${menuLabel}, now on ${current.label}`}
          onClick={() => setOpen(true)}
        >
          {menuLabel} <ChevronDown aria-hidden="true" size={16} />
        </button>
      </div>
      {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
      {open && <StaffMenuDialog titleId={titleId} title={title} tabs={tabs} onClose={() => setOpen(false)} returnTo={buttonRef} />}
    </div>
  );
}
