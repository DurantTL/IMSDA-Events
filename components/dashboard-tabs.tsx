import { NavigationLink as Link } from "@/components/navigation-link";
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
