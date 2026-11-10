import { StaffViewStrip } from "@/components/staff-view-strip";
import { clubFormsViews, type ClubFormsViewKey } from "@/components/club-forms-views";

/** The club form pages strip (#1573): Definitions, Submissions, Missing forms. Drawn on all three views, including the restricted states that know the viewer. */
export function ClubFormsViewsStrip({ administration, current, year, event }: { administration: boolean; current: ClubFormsViewKey; year?: string; event?: string }) {
  return <StaffViewStrip label="Club form pages" views={clubFormsViews({ administration }, current, { year, event })} />;
}
