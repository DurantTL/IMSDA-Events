import { StaffViewStrip } from "@/components/staff-view-strip";
import { mealsViews, type MealsViewKey } from "@/modules/meals/meals-views-model";

/** The meals and kitchen pages strip (#1579), shown on all five pages, including their restricted states. */
export function MealsViewsStrip({ eventId, permissions, current }: { eventId: string; permissions: readonly string[]; current: MealsViewKey }) {
  return <StaffViewStrip label="Meals and kitchen pages" views={mealsViews(eventId, permissions, current)} />;
}
