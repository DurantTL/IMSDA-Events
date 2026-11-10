import type { RowView } from "@/components/staff-tab-row-model";

export type MealsViewKey = "meals" | "kitchen-report" | "counts" | "scanner" | "closeout";

type Spec = { key: MealsViewKey; label: string; path: string; anyOf: readonly string[] };

/**
 * One entry per page, with the permissions its own server check accepts (any one of them opens it). Kept in step with
 * the pages by `tests/meals-views-model-1579.test.ts`.
 */
const specs: readonly Spec[] = [
  { key: "meals", label: "Meals", path: "/more/meals", anyOf: ["CONFIGURE_EVENT", "MANAGE_FINANCE", "VIEW_REPORTS"] },
  { key: "kitchen-report", label: "Kitchen report", path: "/more/kitchen-report", anyOf: ["VIEW_REPORTS"] },
  { key: "counts", label: "Kitchen counts", path: "/more/kitchen-report/counts", anyOf: ["MANAGE_KITCHEN_COUNTS", "VIEW_REPORTS"] },
  { key: "scanner", label: "Scanner results", path: "/more/kitchen-report/scanner-import", anyOf: ["VIEW_REPORTS"] },
  { key: "closeout", label: "Meal closeout", path: "/more/kitchen-report/closeout", anyOf: ["MANAGE_FINANCE"] },
];

/**
 * The meals and kitchen pages a viewer can open (#1579), in order. Presentation only: it grants nothing. Each is shown
 * only when the viewer passes the check its page makes on the server, so the strip never links to a page that refuses
 * them; `current` marks the page being shown. Every link keeps ?event. A kitchen-only viewer gets one view, which the
 * strip renders as nothing.
 */
export function mealsViews(eventId: string, permissions: readonly string[], current?: MealsViewKey): RowView[] {
  return specs
    .filter((spec) => spec.anyOf.some((permission) => permissions.includes(permission)))
    .map((spec) => ({
      key: spec.key,
      label: spec.label,
      href: `${spec.path}?event=${encodeURIComponent(eventId)}`,
      ...(spec.key === current ? { current: true } : {}),
    }));
}
