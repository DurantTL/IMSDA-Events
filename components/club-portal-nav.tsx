"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, FileText, Home, LayoutGrid, MoreHorizontal, Users } from "lucide-react";
import { isAccountNavItemActive, type AccountNavItem } from "@/components/account-section-nav";
import { ClubPortalMenuDialog } from "@/components/club-portal-menu-dialog";
import { isPlainClick } from "@/components/more-launcher-model";
import { clubNavLinks } from "@/modules/club-rosters/nav-year-links";
import { clubPhoneBarSplit, type ClubPhoneBarKey } from "@/modules/club-rosters/portal-phone-bar";
import styles from "@/components/club-portal-nav.module.css";

const rowFitsQuery = "(min-width: 1024px)";

const phoneIcons: Record<ClubPhoneBarKey, typeof Home> = {
  home: Home,
  roster: Users,
  events: CalendarDays,
  records: FileText,
  other: LayoutGrid,
};

type Props = {
  items: AccountNavItem[];
  label?: string;
  /** The club's base path (`/account/clubs/<id>`): the Home and Roster links carry a read-only `?year=` (#1112). */
  base?: string;
  /** The menu line's button: "Club menu" (default "Menu"). The button's accessible name adds the current tab. */
  menuLabel?: string;
  /** The menu's heading: the club's name where it is known, else the button's label. */
  menuTitle?: string;
  /** The club's own pages only: on a phone a bottom bar (Home, Roster, Events, Records, More) replaces the top line. Needs `base`. */
  phoneBar?: boolean;
};

/**
 * The club shell's navigation (#1319, #1641): every destination the role can open, in one of three forms that never
 * scroll sideways. With room it is the flat tab strip. Below 1024px, or when the strip would not fit (a ResizeObserver
 * compares its natural width with its line and sets `data-fit="tight"`), it is the menu line: the current tab and a menu
 * button that opens the full list. On a phone, club pages (`phoneBar`) get a bottom bar of plain links, with More for
 * the tabs the bar does not name. The links only mirror what the server already allowed for this role.
 */
export function ClubPortalNav(props: Props) {
  // useSearchParams needs a Suspense boundary; until it resolves the links are bare.
  return (
    <Suspense fallback={<ClubPortalNavView {...props} years={[]} />}>
      <ClubPortalNavWithYear {...props} />
    </Suspense>
  );
}

function ClubPortalNavWithYear(props: Props) {
  return <ClubPortalNavView {...props} years={useSearchParams().getAll("year")} />;
}

function ClubPortalNavView({
  items,
  label = "Club",
  base,
  menuLabel = "Menu",
  menuTitle,
  phoneBar = false,
  years,
}: Props & { years: string[] }) {
  const pathname = usePathname();
  const lineRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLAnchorElement>(null);
  const [tight, setTight] = useState(false);
  const [open, setOpen] = useState<"all" | "more" | null>(null);
  const titleId = useId();
  // The year rides on the links only; active state still compares each item's bare href.
  const hrefOf = new Map(clubNavLinks(items, base ?? "", years).map(({ item, href }) => [item, href]));
  const split = useMemo(() => (phoneBar && base !== undefined ? clubPhoneBarSplit(items, base) : null), [phoneBar, base, items]);
  // A bar with only Home would be a lone button: keep the menu line on a phone then.
  const bar = split && split.bar.length > 1 ? split : null;
  const current = items.find((item) => isAccountNavItemActive(pathname, item)) ?? items[0];

  useEffect(() => {
    const line = lineRef.current;
    const list = listRef.current;
    if (!line || !list) return;
    const wide = window.matchMedia(rowFitsQuery);
    function measure() {
      if (!line || !list) return;
      // Below 1024px the stylesheet already shows the menu line; there is nothing to measure.
      if (!wide.matches) return;
      setTight(list.getBoundingClientRect().width > line.clientWidth);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    observer.observe(list);
    wide.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", measure);
    };
  }, [items]);

  const entries = (list: readonly AccountNavItem[]) =>
    list.map((item) => ({ key: item.href, label: item.label, href: hrefOf.get(item) ?? item.href, current: isAccountNavItemActive(pathname, item) }));
  const close = () => setOpen(null);

  if (items.length === 0) return null;
  return (
    <div className={styles.nav} data-club-portal-nav data-fit={tight ? "tight" : "ok"} data-phone-bar={bar ? "on" : "off"}>
      <div className={styles.line} ref={lineRef}>
        <nav aria-label={label} className={styles.tabs}>
          <ul className={styles.list} ref={listRef}>
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
        </nav>
        <div className={styles.menuline} data-club-portal-menu-line>
          <span className={styles.current}>{current.label}</span>
          <button
            ref={menuButtonRef}
            type="button"
            className={`secondary-button ${styles.menuButton}`}
            aria-haspopup="dialog"
            aria-expanded={open === "all"}
            aria-label={`${menuLabel}, now on ${current.label}`}
            onClick={() => setOpen("all")}
          >
            {menuLabel} <ChevronDown aria-hidden="true" size={16} />
          </button>
        </div>
      </div>
      {bar && (
        <nav className={styles.phoneBar} aria-label={`${label} mobile navigation`} data-club-phone-bar>
          {bar.bar.map(({ key, label: text, item }) => {
            const Icon = phoneIcons[key];
            // The strip above already says "page"; the bar only says "true", so the document has one "page".
            return (
              <Link key={item.href} className={styles.phoneItem} href={hrefOf.get(item) ?? item.href} aria-current={isAccountNavItemActive(pathname, item) ? "true" : undefined}>
                <Icon aria-hidden="true" size={22} /><span>{text}</span>
              </Link>
            );
          })}
          {bar.more.length > 0 && (
            <Link
              ref={moreRef}
              className={styles.phoneItem}
              href={base!}
              aria-haspopup="dialog"
              aria-expanded={open === "more"}
              aria-current={bar.more.some((item) => isAccountNavItemActive(pathname, item)) ? "true" : undefined}
              onClick={(event) => {
                // A plain click opens the sheet; a new-tab click still goes to the club home.
                if (!isPlainClick(event.nativeEvent)) return;
                event.preventDefault();
                setOpen("more");
              }}
            >
              <MoreHorizontal aria-hidden="true" size={22} /><span>More</span>
            </Link>
          )}
        </nav>
      )}
      {open && (
        <ClubPortalMenuDialog
          titleId={titleId}
          title={menuTitle ?? menuLabel}
          entries={entries(open === "more" && bar ? bar.more : items)}
          onClose={close}
          returnTo={open === "more" ? moreRef : menuButtonRef}
        />
      )}
    </div>
  );
}
