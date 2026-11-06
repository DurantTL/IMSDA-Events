import { GuardedLink } from "@/components/guarded-link";
import type { RailItem, StaffArea } from "@/components/staff-areas";
import styles from "./staff-shell.module.css";

/**
 * The icon rail (#1565): the staff areas this viewer can reach, at most six, with the area the page is in marked
 * `aria-current="true"` (the area, not the page: the page's own tab says "page"). Links are guarded, so an unsaved form
 * asks first. It keeps `id="primary-navigation"`, which the mobile layout audit finds it by.
 */
export function StaffRail({ items, current, badges = {} }: { items: readonly RailItem[]; current: StaffArea; badges?: Partial<Record<StaffArea, number>> }) {
  return (
    <nav className={styles.rail} id="primary-navigation" aria-label="Primary navigation">
      <ul>
        {items.map(({ area, label, href, icon: Icon }) => {
          const count = badges[area];
          return (
            <li key={area}>
              <GuardedLink className={styles.railItem} href={href} aria-current={area === current ? "true" : undefined}>
                <Icon aria-hidden="true" size={22} strokeWidth={1.9} />
                <span>{label}</span>
                {count ? <span className={styles.railBadge}><span aria-hidden="true">{count > 99 ? "99+" : count}</span><span className="sr-only"> {count} waiting</span></span> : null}
              </GuardedLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
