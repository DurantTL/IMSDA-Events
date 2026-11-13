"use client";

import { usePathname } from "next/navigation";
import { GuardedLink } from "@/components/guarded-link";
import { viewCurrent, type RowView } from "@/components/staff-tab-row-model";
import styles from "./staff-shell.module.css";

/**
 * The views inside the current tab (#1565): a bordered strip of links, the current one filled navy. Never a second tab
 * row, and at most five (the model caps them). A strip of one view is no strip. A strip that only changes a choice on the
 * same page (`choice`, such as a time period) marks its current item "true", not "page": the section tab already says "page".
 */
export function StaffViewStrip({ label, views, choice = false }: { label: string; views: readonly RowView[]; choice?: boolean }) {
  const pathname = usePathname();
  if (views.length < 2) return null;
  return (
    <div className={styles.views} role="group" aria-label={label} data-staff-views>
      {views.map((view) => (
        <GuardedLink key={view.key} href={view.href} aria-current={choice ? (view.current ? "true" : undefined) : viewCurrent(view, pathname)}>{view.label}</GuardedLink>
      ))}
    </div>
  );
}
