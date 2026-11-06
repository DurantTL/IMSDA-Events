import type { RailItem, StaffPlace } from "@/components/staff-areas";
import type { EventTab, EventTabKey } from "@/components/staff-event-tabs";

/**
 * The phone's bottom bar (#1565): Home, Events, Check-in, Clubs and More, filtered by what the viewer can reach (a person
 * who cannot check in has no Check-in, one without club access has no Clubs). It is built from the rail and the event
 * tabs, so a phone cannot reach a page a desktop cannot, nor the other way round (`tests/mobile-directory-parity.test.ts`).
 */
export type PhoneBarKey = "home" | "events" | "check-in" | "clubs" | "more";
/** `also` names the items dropped because they open the same page (a Clubs Administrator's Home is the Clubs landing). */
export type PhoneBarItem = { key: PhoneBarKey; label: string; href: string; also?: PhoneBarKey[] };

export const phoneBarLabels: Record<PhoneBarKey, string> = { home: "Home", events: "Events", "check-in": "Check-in", clubs: "Clubs", more: "More" };

export function phoneBarItems(input: {
  rail: readonly RailItem[];
  eventTabs: readonly EventTab[];
  /** Where More goes without scripts: the /more page, or Help when there is no event. `null` leaves More out. */
  moreHref: string | null;
  /** The person's main dashboard (their role's landing page); staff with no admin role start in their event. */
  homeHref?: string;
}): PhoneBarItem[] {
  const { rail, eventTabs, moreHref } = input;
  const railHref = (area: RailItem["area"]) => rail.find((item) => item.area === area)?.href;
  // Home is not on the rail (#1568 builds its pages); the bar's Home slot opens the main dashboard, or for staff with no admin
  // role their event's first tab (the dashboard, or the kitchen counts).
  const home = input.homeHref ?? eventTabs[0]?.href;
  const candidates: Array<[PhoneBarKey, string | undefined]> = [
    ["home", home],
    ["events", railHref("events")],
    ["check-in", eventTabs.find((tab) => tab.key === "check-in")?.href],
    ["clubs", railHref("clubs")],
    ["more", moreHref ?? undefined],
  ];
  const items: PhoneBarItem[] = [];
  for (const [key, href] of candidates) {
    if (!href) continue;
    // Two items for one page would both light; the first keeps it, and lights for the other's pages too.
    const twin = key === "more" || key === "clubs" ? undefined : items.find((item) => item.key !== "more" && item.href === href);
    if (twin) {
      twin.also = [...(twin.also ?? []), key];
      continue;
    }
    items.push({ key, label: phoneBarLabels[key], href });
  }
  return items;
}

/** The one bar item the page lights: its own, else More. */
export function phoneBarCurrent(
  items: readonly PhoneBarItem[],
  place: Pick<StaffPlace, "area" | "inEvent">,
  eventTab: EventTabKey | null,
  /** The event tab Home opens for staff with no Home area (their first tab). */
  firstEventTab: EventTabKey | null = null,
  /** The current path: Home lights only on exactly its own page, and only when no other item owns the page. */
  pathname = "",
): PhoneBarKey | null {
  const has = (key: PhoneBarKey) => items.some((item) => item.key === key || item.also?.includes(key));
  const owner = (key: PhoneBarKey) => items.find((item) => item.key === key || item.also?.includes(key))?.key ?? null;
  let key: PhoneBarKey;
  if (place.area === "home") key = "more";
  else if (place.inEvent && eventTab === "check-in") key = "check-in";
  else if (place.area === "events") {
    // Staff whose Events item is the same page as Home (their event's first tab) light it only on that tab; the event's
    // other tabs are "This event" in More. With an Events item of its own, every event page lights it.
    const eventsIsHomeTwin = items.some((item) => item.also?.includes("events"));
    key = !has("events") || (eventsIsHomeTwin && place.inEvent && eventTab !== firstEventTab) ? "more" : "events";
  }
  else if (place.area === "clubs") key = "clubs";
  else key = "more";
  const home = items.find((item) => item.key === "home");
  const homeIsExactPage = Boolean(home) && new URL(home!.href, "https://events.example.test").pathname === pathname;
  // A page no other bar item owns that is exactly the Home page lights Home, not More.
  if (homeIsExactPage && (key === "more" || !has(key))) return "home";
  if (has(key)) return owner(key);
  return has("more") ? "more" : null;
}
