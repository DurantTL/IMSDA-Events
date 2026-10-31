"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { nextTabIndex } from "@/components/registration-builder/sidebar-tabs";
import styles from "./tab-list.module.css";

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
 * A tab's panel (role="tabpanel", focusable per the APG so a keyboard user can reach panel content that has no focusable
 * part first). It has a real box: a one-column grid with the page's 18px gap, so what it holds spaces out as it did
 * directly inside `.page-stack`. Pass your own `className` to lay it out yourself. Hide a panel that stays mounted with
 * `hidden`.
 */
export function TabPanel({ id, tabId, hidden, stack = true, className, children }: {
  id: string;
  tabId: string;
  hidden?: boolean;
  /** False for a plain block, for content that was already wrapped in its own block and must not gain a gap between its parts. */
  stack?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div role="tabpanel" id={id} aria-labelledby={tabId} hidden={hidden} tabIndex={0} className={className ?? (stack ? styles.panel : undefined)}>
      {children}
    </div>
  );
}
