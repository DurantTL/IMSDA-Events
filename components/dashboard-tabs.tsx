"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { NavigationLink as Link } from "@/components/navigation-link";
import { nextTabIndex } from "@/components/registration-builder/sidebar-tabs";
import styles from "./dashboard-tabs.module.css";

export type DashboardTab = { key: string; label: string; href: string };

/** A tab that can say it is current itself: "page" on its own page, "true" on another page of its area (#1274). */
export type CurrentDashboardTab = DashboardTab & { current?: "page" | "true" };

/**
 * The tab row at the top of an admin dashboard (#1227, #1228): plain links, never buttons, so nothing here changes a
 * record. The current tab carries `aria-current="page"` on its own page (`currentKey`, or a tab's own `current`), and
 * `aria-current="true"` on another page of the same area. On a phone the row scrolls sideways inside itself, so the
 * page never scrolls sideways.
 */
export function DashboardTabs({ label, tabs, currentKey }: { label: string; tabs: readonly CurrentDashboardTab[]; currentKey?: string }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      <ul>
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link href={tab.href} aria-current={tab.current ?? (tab.key === currentKey ? "page" : undefined)}>{tab.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export type TabListItem = {
  key: string;
  /** The tab button's id; the panel names it with `aria-labelledby`. */
  id: string;
  label: ReactNode;
  /**
   * The id of this tab's panel. Leave it out while that panel is not in the page (a panel that only renders while its tab
   * is selected), so `aria-controls` never names an id that is missing.
   */
  panelId?: string;
};

/**
 * A row of real tabs (WAI-ARIA Tabs pattern, #1353): one tab stop for the row (the selected tab), Left and Right move
 * between tabs and wrap, Home and End jump to the ends.
 *
 * - `activation="automatic"` (default): moving focus also selects, for tabs that only swap what is shown.
 * - `activation="manual"`: arrows move focus only; Enter, Space or a click selects. Use it when selecting can ask a
 *   question or leave the page (unsaved changes, a URL change).
 *
 * The caller's classes style the row and the buttons, so a tab row keeps its look: `selectedClassName` is added to the
 * selected button (for rows styled with `.active`). Not for navigation: links to other pages use `DashboardTabs`.
 */
export function TabList({ label, tabs, selectedKey, onSelect, activation = "automatic", className, tabClassName, selectedClassName }: {
  label: string;
  tabs: readonly TabListItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  activation?: "automatic" | "manual";
  className?: string;
  tabClassName?: string;
  selectedClassName?: string;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  // A selection that names no tab still leaves the first one reachable by keyboard.
  const selectedIndex = Math.max(0, tabs.findIndex((tab) => tab.key === selectedKey));

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const next = nextTabIndex(event.key, index, tabs.length);
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next]!;
    refs.current.get(target.key)?.focus();
    if (activation === "automatic" && target.key !== selectedKey) onSelect(target.key);
  }

  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = index === selectedIndex && tab.key === selectedKey;
        return (
          <button
            key={tab.key}
            ref={(node) => { if (node) refs.current.set(tab.key, node); else refs.current.delete(tab.key); }}
            type="button"
            role="tab"
            id={tab.id}
            aria-selected={selected}
            aria-controls={tab.panelId}
            tabIndex={index === selectedIndex ? 0 : -1}
            className={[tabClassName, selected ? selectedClassName : undefined].filter(Boolean).join(" ") || undefined}
            onClick={() => onSelect(tab.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >{tab.label}</button>
        );
      })}
    </div>
  );
}

/**
 * A tab's panel. By default it adds no box of its own (`display: contents`), so what it holds lays out exactly as it did
 * before it was wrapped; pass `contents={false}` for a plain block, or your own `className`. Hide a panel that stays
 * mounted with `hidden`.
 */
export function TabPanel({ id, tabId, hidden, contents = true, className, children }: {
  id: string;
  tabId: string;
  hidden?: boolean;
  contents?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div role="tabpanel" id={id} aria-labelledby={tabId} hidden={hidden} className={className ?? (contents ? styles.panel : undefined)}>
      {children}
    </div>
  );
}
