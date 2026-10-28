import type { AccountNavItem } from "@/components/account-section-nav";
import { rosterYearView } from "@/modules/club-rosters/domain";

/**
 * Keeps a read-only club year in the club navigation (#1112). Only Home and
 * Roster read `?year=`; when the current URL names exactly one year and
 * `rosterYearView` says it is a valid past or next year, those two links carry
 * it. Every other link (other tools, anchors) stays as given, so each item's
 * bare `href` is still what active-state matching compares. Kept apart from
 * portal-nav.ts so the client nav does not bundle the club-forms domain.
 */
export function clubNavLinks(
  items: AccountNavItem[],
  base: string,
  yearValues: string[],
  now = new Date(),
): { item: AccountNavItem; href: string }[] {
  const view = yearValues.length === 1 ? rosterYearView(yearValues[0], now) : null;
  const carry = view && view.readOnly ? `?year=${view.clubYear}` : "";
  return items.map((item) => ({
    item,
    href: carry && (item.href === base || item.href === `${base}/roster`) ? `${item.href}${carry}` : item.href,
  }));
}
