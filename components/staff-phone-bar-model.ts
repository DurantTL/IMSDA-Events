import type { RailItem, StaffPlace } from "@/components/staff-areas";
import type { EventTab, EventTabKey } from "@/components/staff-event-tabs";

/**
 * The phone's bottom bar (#1565): Home, Events, Check-in, Clubs and More, filtered by what the viewer can reach (a person
 * who cannot check in has no Check-in, one without club access has no Clubs). It is built from the rail and the event
 * tabs, so a phone cannot reach a page a desktop cannot, nor the other way round (`tests/mobile-directory-parity.test.ts`).
 */
export type PhoneBarKey = "home" | "events" | "check-in" | "clubs" | "more";
export type PhoneBarItem = { key: PhoneBarKey; label: string; href: string };

export const phoneBarLabels: Record<PhoneBarKey, string> = { home: "Home", events: "Events", "check-in": "Check-in", clubs: "Clubs", more: "More" };

export function phoneBarItems(input: {
  rail: readonly RailItem[];
  eventTabs: readonly EventTab[];
  /** Where More goes without scripts: the /more page, or Help when there is no event. `null` leaves More out. */
  moreHref: string | null;
}): PhoneBarItem[] {
  const { rail, eventTabs, moreHref } = input;
  const railHref = (area: RailItem["area"]) => rail.find((item) => item.area === area)?.href;
  // Staff with no Home area (no admin role) start in their event: its first tab (the dashboard, or the kitchen counts).
  const home = railHref("home") ?? eventTabs[0]?.href;
  const candidates: Array<[PhoneBarKey, string | undefined]> = [
    ["home", home],
    ["events", railHref("events")],
    ["check-in", eventTabs.find((tab) => tab.key === "check-in")?.href],
    ["clubs", railHref("clubs")],
    ["more", moreHref ?? undefined],
  ];
  const seen = new Set<string>();
  const items: PhoneBarItem[] = [];
  for (const [key, href] of candidates) {
    if (!href) continue;
    // Two items for one page would both light; the first keeps it.
    if (key !== "more" && seen.has(href)) continue;
    seen.add(href);
    items.push({ key, label: phoneBarLabels[key], href });
  }
  return items;
}

/** The one bar item the page lights: its own, else More. */
export function phoneBarCurrent(items: readonly PhoneBarItem[], place: Pick<StaffPlace, "area" | "inEvent">, eventTab: EventTabKey | null): PhoneBarKey | null {
  const has = (key: PhoneBarKey) => items.some((item) => item.key === key);
  let key: PhoneBarKey;
  if (place.area === "home") key = "home";
  else if (place.inEvent && eventTab === "check-in") key = "check-in";
  else if (place.area === "events") key = has("events") ? "events" : "home";
  else if (place.area === "clubs") key = "clubs";
  else key = "more";
  if (has(key)) return key;
  return has("more") ? "more" : null;
}
