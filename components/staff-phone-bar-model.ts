import type { RailItem, StaffPlace } from "@/components/staff-areas";
import type { EventTab, EventTabKey } from "@/components/staff-event-tabs";

/**
 * The phone's bottom bar (#1565): Home, Events, Check-in, Clubs and More, filtered by what the viewer can reach (a person
 * who cannot check in has no Check-in, one without club access has no Clubs). It is built from the rail and the event
 * tabs, so a phone cannot reach a page a desktop cannot, nor the other way round (`tests/mobile-directory-parity.test.ts`).
 */
export type PhoneBarKey = "home" | "events" | "check-in" | "clubs" | "more";
/** `also` names the items folded into this one because they open the same page (staff with no admin role: Events is their event tab). */
export type PhoneBarItem = {
  key: PhoneBarKey;
  label: string;
  href: string;
  also?: PhoneBarKey[];
  /** Events opens the event's first tab (staff with no Events row): it lights only there; the event's other tabs are "This event" in More. */
  firstTabOnly?: boolean;
};

export const phoneBarLabels: Record<PhoneBarKey, string> = { home: "Home", events: "Events", "check-in": "Check-in", clubs: "Clubs", more: "More" };

export function phoneBarItems(input: {
  rail: readonly RailItem[];
  eventTabs: readonly EventTab[];
  /** Where More goes without scripts: the /more page, or Help when there is no event. `null` leaves More out. */
  moreHref: string | null;
}): PhoneBarItem[] {
  const { rail, eventTabs, moreHref } = input;
  const railHref = (area: RailItem["area"]) => rail.find((item) => item.area === area)?.href;
  // Home opens its own page (/home, "Needs you", #1568) for every staff viewer, so it never shares a page with Events or Clubs.
  const candidates: Array<[PhoneBarKey, string | undefined]> = [
    ["home", railHref("home")],
    ["events", railHref("events")],
    ["check-in", eventTabs.find((tab) => tab.key === "check-in")?.href],
    ["clubs", railHref("clubs")],
    ["more", moreHref ?? undefined],
  ];
  const items: PhoneBarItem[] = [];
  for (const [key, href] of candidates) {
    if (!href) continue;
    // Two items for one page would both light; the first keeps it, and lights for the other's pages too (staff whose only
    // event page is the check-in station).
    const twin = key === "more" || key === "clubs" ? undefined : items.find((item) => item.key !== "more" && item.href === href);
    if (twin) {
      twin.also = [...(twin.also ?? []), key];
      continue;
    }
    const firstTabOnly = key === "events" && eventTabs.length > 0 && pathOf(href) === pathOf(eventTabs[0].href);
    items.push({ key, label: phoneBarLabels[key], href, ...(firstTabOnly ? { firstTabOnly } : {}) });
  }
  return items;
}

function pathOf(href: string) {
  return new URL(href, "https://events.example.test").pathname;
}

/** The one bar item the page lights: its own, else More. Home's two pages light Home; Help and Profile (Home, no tab) light More. */
export function phoneBarCurrent(
  items: readonly PhoneBarItem[],
  place: Pick<StaffPlace, "area" | "inEvent"> & { tab?: string | null },
  eventTab: EventTabKey | null,
  /** The key of the event's first tab, for an Events item that only opens it. */
  firstEventTab: EventTabKey | null = null,
): PhoneBarKey | null {
  const has = (key: PhoneBarKey) => items.some((item) => item.key === key || item.also?.includes(key));
  const owner = (key: PhoneBarKey) => items.find((item) => item.key === key || item.also?.includes(key))?.key ?? null;
  let key: PhoneBarKey;
  if (place.area === "home") key = place.tab ? "home" : "more";
  else if (place.inEvent && eventTab === "check-in") key = "check-in";
  else if (place.area === "events") {
    const firstTabOnly = items.some((item) => item.key === "events" && item.firstTabOnly);
    key = !has("events") || (firstTabOnly && place.inEvent && eventTab !== firstEventTab) ? "more" : "events";
  }
  else if (place.area === "clubs") key = "clubs";
  else key = "more";
  if (has(key)) return owner(key);
  return has("more") ? "more" : null;
}
