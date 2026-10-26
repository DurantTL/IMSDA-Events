import Link from "next/link";
import styles from "./dashboard-tabs.module.css";

export type DashboardTab = { key: string; label: string; href: string };

/**
 * The tab row at the top of an admin dashboard (#1227, #1228): plain links, never buttons, so nothing here changes a
 * record. The current tab carries `aria-current="page"`. The row wraps on a phone, so it never scrolls the page sideways.
 */
export function DashboardTabs({ label, tabs, currentKey }: { label: string; tabs: readonly DashboardTab[]; currentKey: string }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      <ul>
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link href={tab.href} aria-current={tab.key === currentKey ? "page" : undefined}>{tab.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
