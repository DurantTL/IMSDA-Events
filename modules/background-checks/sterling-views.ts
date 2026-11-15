import type { RowView } from "@/components/staff-tab-row-model";

/**
 * The Sterling Volunteers screening task's views (#1589 part D). People to follow up is the default (no `view` in the
 * address); Needs a look and Youth and children's events each open on their own, so the page shows one task at a time.
 * Presentation only: the same reads, routes and permissions as before.
 */
export const STERLING_PAGE_PATH = "/admin/organizations/background-checks";

export const STERLING_VIEWS = ["follow-up", "review", "events"] as const;
export type SterlingView = typeof STERLING_VIEWS[number];

export function parseSterlingView(value: string | string[] | undefined): SterlingView {
  const raw = Array.isArray(value) ? value[0] : value;
  return (STERLING_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as SterlingView) : "follow-up";
}

export function sterlingViewHref(view: SterlingView): string {
  return view === "follow-up" ? STERLING_PAGE_PATH : `${STERLING_PAGE_PATH}?view=${view}`;
}

/** The strip's links. Needs a look carries the count of rows waiting for a staff decision. */
export function sterlingViews(current: SterlingView, reviewCount: number): RowView[] {
  const labels: Record<SterlingView, string> = {
    "follow-up": "People to follow up",
    review: `Needs a look (${reviewCount})`,
    events: "Youth and children’s events",
  };
  return STERLING_VIEWS.map((key) => ({
    key,
    label: labels[key],
    href: sterlingViewHref(key),
    ...(key === current ? { current: true } : {}),
  }));
}
