import { GuardedLink } from "@/components/guarded-link";
import type { RowView } from "@/components/staff-tab-row-model";
import styles from "./staff-shell.module.css";

/**
 * The views inside the current tab (#1565): a bordered strip of links, the current one filled navy. Never a second tab
 * row, and at most five (the model caps them). A strip of one view is no strip.
 */
export function StaffViewStrip({ label, views }: { label: string; views: readonly RowView[] }) {
  if (views.length < 2) return null;
  return (
    <div className={styles.views} role="group" aria-label={label} data-staff-views>
      {views.map((view) => (
        <GuardedLink key={view.key} href={view.href} aria-current={view.current ? "page" : undefined}>{view.label}</GuardedLink>
      ))}
    </div>
  );
}
