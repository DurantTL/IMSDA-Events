import { StaffViewStrip } from "@/components/staff-view-strip";
import { eventClubsViews, type EventClubsViewAccess, type EventClubsViewKey } from "@/modules/club-rosters/event-clubs-views-model";

/** The event club pages strip (#1582): Clubs attending, Club assignments, Monthly Records. Shown on all three pages, including their restricted states. */
export function EventClubsViewsStrip({ eventId, access, current }: { eventId: string; access: EventClubsViewAccess; current: EventClubsViewKey }) {
  return <StaffViewStrip label="Event club pages" views={eventClubsViews(eventId, access, current)} />;
}
