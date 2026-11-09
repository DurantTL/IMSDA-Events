import type { RowView } from "@/components/staff-tab-row-model";

export type EventClubsViewKey = "attending" | "assignments" | "records";

/** What the viewer can open, each worked out by the check the page itself makes (the pages and APIs still check on the server). */
export type EventClubsViewAccess = {
  /** `resolveClubOversight(...).allowed`: Clubs attending and Monthly Records. */
  oversight: boolean;
  /** `canManageClubAssignments(permissions)` on a club event: Club assignments. */
  assignments: boolean;
};

/**
 * The event club pages a viewer can open (#1582), in order. Presentation only: it grants nothing. Every link keeps
 * ?event, and `current` marks the page being shown.
 */
export function eventClubsViews(eventId: string, access: EventClubsViewAccess, current?: EventClubsViewKey): RowView[] {
  const eventQuery = `?event=${encodeURIComponent(eventId)}`;
  const specs: ReadonlyArray<{ key: EventClubsViewKey; label: string; path: string; shown: boolean }> = [
    { key: "attending", label: "Clubs attending", path: "/more/clubs", shown: access.oversight },
    { key: "assignments", label: "Club assignments", path: "/more/club-assignments", shown: access.assignments },
    { key: "records", label: "Monthly Records", path: "/more/clubs/reports", shown: access.oversight },
  ];
  return specs
    .filter((spec) => spec.shown)
    .map((spec) => ({ key: spec.key, label: spec.label, href: `${spec.path}${eventQuery}`, ...(spec.key === current ? { current: true } : {}) }));
}
