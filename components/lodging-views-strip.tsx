import { StaffViewStrip } from "@/components/staff-view-strip";
import { lodgingViews, type LodgingViewAccess, type LodgingViewKey } from "@/modules/lodging/lodging-views-model";

/** The Lodging pages strip (#1578): Inventory, Requests, Assignments. Shown on all three pages, including their restricted and "no property yet" states. */
export function LodgingViewsStrip({ eventId, access, current }: { eventId: string; access: LodgingViewAccess; current: LodgingViewKey }) {
  return <StaffViewStrip label="Lodging pages" views={lodgingViews(eventId, access, current)} />;
}
