import Link from "next/link";
import styles from "@/components/public-home-page.module.css";

export type PublicExploreCurrent = "home" | "events" | "calendar" | "clubs";

/**
 * The public header navigation (#1561): Home, Events, Calendar, Club ministry.
 * `current` marks the page being viewed; `currentKind` is "location" for a page inside that section.
 */
export function PublicExploreNav({ current, currentKind = "page" }: { current?: PublicExploreCurrent; currentKind?: "page" | "location" }) {
  const mark = (key: PublicExploreCurrent) => (current === key ? ({ "aria-current": currentKind } as const) : {});
  return (
    <nav aria-label="Explore" className={styles.primaryNav}>
      <Link href="/" {...mark("home")}>Home</Link>
      <Link href="/events" {...mark("events")}>Events</Link>
      {/* A plain anchor: /calendar has its own Content-Security-Policy, which a client-side navigation would not pick up (#1212). */}
      <a href="/calendar" {...mark("calendar")}>Calendar</a>
      <a href="/clubs" {...mark("clubs")}>Club ministry</a>
    </nav>
  );
}
