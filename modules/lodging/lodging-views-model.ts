import type { RowView } from "@/components/staff-tab-row-model";

export type LodgingViewKey = "inventory" | "requests" | "assignments";

/** What the viewer can open, each worked out by the check the page itself makes (the pages and APIs still check on the server). */
export type LodgingViewAccess = {
  /** `CONFIGURE_EVENT`: the Inventory page. */
  inventory: boolean;
  /** `MANAGE_REGISTRATION`: the Requests and Assignments pages. */
  registrations: boolean;
};

/**
 * The Lodging pages a viewer can open (#1578), in order. Presentation only: it grants nothing. A page the viewer cannot open
 * is left out, never offered as a link to a closed page (#1735). Every link keeps ?event, and `current` marks the page shown.
 */
export function lodgingViews(eventId: string, access: LodgingViewAccess, current?: LodgingViewKey): RowView[] {
  const eventQuery = `?event=${encodeURIComponent(eventId)}`;
  const specs: ReadonlyArray<{ key: LodgingViewKey; label: string; path: string; shown: boolean }> = [
    { key: "inventory", label: "Inventory", path: "/more/lodging", shown: access.inventory },
    { key: "requests", label: "Requests", path: "/more/lodging/requests", shown: access.registrations },
    { key: "assignments", label: "Assignments", path: "/more/lodging/assignments", shown: access.registrations },
  ];
  return specs
    .filter((spec) => spec.shown)
    .map((spec) => ({ key: spec.key, label: spec.label, href: `${spec.path}${eventQuery}`, ...(spec.key === current ? { current: true } : {}) }));
}

/** The access a page works out from the event permissions it already holds. */
export function lodgingViewAccess(permissions: readonly string[]): LodgingViewAccess {
  return { inventory: permissions.includes("CONFIGURE_EVENT"), registrations: permissions.includes("MANAGE_REGISTRATION") };
}

const shortNight = (night: string) => new Date(`${night}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The night window every Lodging view names beside its description, so the context never disappears between views:
 * "Jun 15 to Jun 17, 3 nights". The nights come from the server's view; this only words them.
 */
export function lodgingNightsLine(nights: readonly string[]): string {
  if (nights.length === 0) return "no bookable nights";
  const first = shortNight(nights[0]!);
  const last = shortNight(nights[nights.length - 1]!);
  const count = `${nights.length} ${nights.length === 1 ? "night" : "nights"}`;
  return nights.length === 1 ? `${first}, ${count}` : `${first} to ${last}, ${count}`;
}
