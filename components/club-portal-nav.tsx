"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { isAccountNavItemActive, type AccountNavItem } from "@/components/account-section-nav";
import { clubNavLinks } from "@/modules/club-rosters/nav-year-links";
import styles from "@/components/club-portal-nav.module.css";

/**
 * The club shell's navigation (#1319): every destination the role can open as
 * a tab link in one row. When the row is wider than the screen it scrolls
 * sideways (the links stay ordinary tab stops, so the keyboard reaches each
 * one and the browser scrolls it into view), and the current tab is brought
 * into view on load and on each page change. The links only mirror what the
 * server already allowed for this role.
 */
export function ClubPortalNav(props: {
  items: AccountNavItem[];
  label?: string;
  /** The club's base path (`/account/clubs/<id>`): the Home and Roster links carry a read-only `?year=` (#1112). */
  base?: string;
}) {
  // useSearchParams needs a Suspense boundary; until it resolves the links are bare.
  return (
    <Suspense fallback={<ClubPortalNavView {...props} years={[]} />}>
      <ClubPortalNavWithYear {...props} />
    </Suspense>
  );
}

function ClubPortalNavWithYear(props: Parameters<typeof ClubPortalNav>[0]) {
  return <ClubPortalNavView {...props} years={useSearchParams().getAll("year")} />;
}

function ClubPortalNavView({
  items,
  label = "Club",
  base,
  years,
}: Parameters<typeof ClubPortalNav>[0] & { years: string[] }) {
  const pathname = usePathname();
  const stripRef = useRef<HTMLDivElement>(null);
  // The year rides on the links only; active state still compares each item's bare href.
  const hrefOf = new Map(clubNavLinks(items, base ?? "", years).map(({ item, href }) => [item, href]));

  // Keep the current tab in view inside the strip. Only the strip scrolls, never the page.
  useEffect(() => {
    const strip = stripRef.current;
    const current = strip?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!strip || !current) return;
    const left = current.offsetLeft;
    const right = left + current.offsetWidth;
    let target = strip.scrollLeft;
    if (left < strip.scrollLeft) target = left;
    else if (right > strip.scrollLeft + strip.clientWidth) target = right - strip.clientWidth;
    if (target === strip.scrollLeft) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    strip.scrollTo({ left: target, behavior: reduced ? "auto" : "smooth" });
  }, [pathname]);

  return (
    <nav aria-label={label} className={styles.nav}>
      <div className={styles.strip} ref={stripRef}>
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.href}>
              <Link
                aria-current={isAccountNavItemActive(pathname, item) ? "page" : undefined}
                className={styles.link}
                href={hrefOf.get(item) ?? item.href}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
