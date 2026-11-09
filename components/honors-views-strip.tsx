import { StaffViewStrip } from "@/components/staff-view-strip";
import { honorsViews, type HonorsViewKey } from "@/modules/honors/honors-views-model";

/** The Honors Weekend pages strip (#1580), shown on all four pages, including their restricted states. */
export function HonorsViewsStrip({ eventId, permissions, current }: { eventId: string; permissions: readonly string[]; current: HonorsViewKey }) {
  return <StaffViewStrip label="Honors Weekend pages" views={honorsViews(eventId, permissions, current)} />;
}
