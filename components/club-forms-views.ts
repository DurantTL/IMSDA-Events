import type { RowView } from "@/components/staff-tab-row-model";

export type ClubFormsViewKey = "definitions" | "submissions" | "missing";

/**
 * The views of the club forms pages (#1573), in order. Presentation only: it grants nothing, and every page keeps its own check.
 * `administration` is what the page already knows about the viewer (`hasClubsAdministration`, or on the submissions pages
 * `viewer.systemAdmin || viewer.clubsAdministrator`): Definitions and Missing forms are shown only to them. Submissions is
 * shown to anyone who can open it, so a viewer with only Submissions gets one view, and the strip draws nothing for one.
 * `year` rides on Missing forms; `event` rides on Submissions when the page was opened from an event's More card.
 */
export function clubFormsViews(
  access: { administration: boolean },
  current?: ClubFormsViewKey,
  carry: { year?: string; event?: string } = {},
): RowView[] {
  const missingQuery = carry.year ? `&year=${encodeURIComponent(carry.year)}` : "";
  const submissionsQuery = carry.event ? `?event=${encodeURIComponent(carry.event)}` : "";
  const specs: ReadonlyArray<{ key: ClubFormsViewKey; label: string; href: string; shown: boolean }> = [
    { key: "definitions", label: "Definitions", href: "/admin/club-forms", shown: access.administration },
    { key: "submissions", label: "Submissions", href: `/more/club-forms${submissionsQuery}`, shown: true },
    { key: "missing", label: "Missing forms", href: `/admin/club-forms?view=missing${missingQuery}`, shown: access.administration },
  ];
  return specs
    .filter((spec) => spec.shown)
    .map((spec) => ({ key: spec.key, label: spec.label, href: spec.href, ...(spec.key === current ? { current: true } : {}) }));
}
