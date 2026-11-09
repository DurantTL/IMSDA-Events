import type { RowView } from "@/components/staff-tab-row-model";

export type HonorsViewKey = "classes" | "schedule" | "instructors" | "rosters";

const specs: ReadonlyArray<{ key: HonorsViewKey; label: string; path: string; permission: "CONFIGURE_EVENT" | "VIEW_REPORTS" }> = [
  { key: "classes", label: "Classes", path: "/more/honors", permission: "CONFIGURE_EVENT" },
  { key: "schedule", label: "Schedule board", path: "/more/honors/schedule", permission: "CONFIGURE_EVENT" },
  { key: "instructors", label: "Instructors", path: "/more/honors/instructors", permission: "CONFIGURE_EVENT" },
  { key: "rosters", label: "Rosters", path: "/more/honors/rosters", permission: "VIEW_REPORTS" },
];

/**
 * The Honors Weekend pages a viewer can open (#1580), in order. Each is gated by the same permission its page checks
 * (the pages and their APIs still check on the server); `current` marks the page being shown. Every link keeps ?event.
 */
export function honorsViews(eventId: string, permissions: readonly string[], current?: HonorsViewKey): RowView[] {
  return specs
    .filter((spec) => permissions.includes(spec.permission))
    .map((spec) => ({
      key: spec.key,
      label: spec.label,
      href: `${spec.path}?event=${encodeURIComponent(eventId)}`,
      ...(spec.key === current ? { current: true } : {}),
    }));
}
