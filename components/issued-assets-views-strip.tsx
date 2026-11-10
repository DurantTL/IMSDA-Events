import { StaffViewStrip } from "@/components/staff-view-strip";
import { issuedAssetsViews, type IssuedAssetsViewKey } from "@/components/issued-assets-views-model";

/** The issued item pages strip (#1581): Inventory and Closeout, each shown only to someone the page admits. One view draws nothing. */
export function IssuedAssetsViewsStrip({ eventId, permissions, current }: { eventId: string; permissions: readonly string[]; current: IssuedAssetsViewKey }) {
  return <StaffViewStrip label="Issued item pages" views={issuedAssetsViews(eventId, permissions, current)} />;
}
