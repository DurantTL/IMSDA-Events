import type { AccountNavItem } from "@/components/account-section-nav";

// Kept apart from portal-nav.ts (like nav-year-links.ts) so the client nav bundles no server-side domain code.

export type ClubPhoneBarKey = "home" | "roster" | "events" | "records" | "other";
export type ClubPhoneBarItem = { key: ClubPhoneBarKey; label: string; item: AccountNavItem };

/** The phone bar's four named slots (#1641): where each one points (relative to the club base) and its short label. */
const PHONE_BAR_SLOTS: readonly { key: Exclude<ClubPhoneBarKey, "other">; suffix: string; label: string }[] = [
  { key: "home", suffix: "", label: "Home" },
  { key: "roster", suffix: "/roster", label: "Roster" },
  { key: "events", suffix: "/events", label: "Events" },
  { key: "records", suffix: "/records", label: "Records" },
];

/** The most slots the phone bar has, More included. */
export const CLUB_PHONE_BAR_SLOTS = 5;

/**
 * Splits the club shell's list (already built and ordered by `clubShellNavigation`, so no role gains a destination here)
 * between the phone's bottom bar and its More sheet (#1641). The bar names Home, Roster, Events (Club events) and
 * Records (Monthly Records), keeping only those the role has. A role with five tabs or fewer has every tab in the bar
 * and no More; with more, the tabs the bar does not name go to More, so together they reach every tab. `base` is the
 * club's path (`/account/clubs/<id>`).
 */
export function clubPhoneBarSplit(items: readonly AccountNavItem[], base: string): { bar: ClubPhoneBarItem[]; more: AccountNavItem[] } {
  const named = (item: AccountNavItem) => PHONE_BAR_SLOTS.find((slot) => item.href === `${base}${slot.suffix}`);
  if (items.length <= CLUB_PHONE_BAR_SLOTS) {
    return { bar: items.map((item) => ({ key: named(item)?.key ?? "other", label: named(item)?.label ?? item.label, item })), more: [] };
  }
  const bar = PHONE_BAR_SLOTS.flatMap((slot) => {
    const item = items.find((candidate) => candidate.href === `${base}${slot.suffix}`);
    return item ? [{ key: slot.key, label: slot.label, item }] : [];
  });
  const inBar = new Set(bar.map((entry) => entry.item));
  return { bar, more: items.filter((item) => !inBar.has(item)) };
}
