import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { AttendancePointsWorkspace } from "@/components/attendance-points-workspace";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { staffPageTitles } from "@/components/staff-navigation";
import { logError } from "@/lib/logger";
import { AttendancePointsError, loadAttendancePointsView, type AttendancePointsActor } from "@/modules/event-points/service";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";

export const metadata: Metadata = { title: staffPageTitles.attendancePoints };
export const dynamic = "force-dynamic";

/**
 * Staff screen for the optional Attendance points tool (#1677): the switch, the points for the event, the review of each
 * club with who counted and why, overrides, and apply or undo. Administrators only (a system administrator, an Event Admin or
 * the Clubs Administrator, the people `resolveClubOversight` admits). It also works on a club event that is not published yet.
 */
export default async function AttendancePointsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const requested = (await searchParams).event;
  const { event, allowed, clubEvent, user } = await resolveClubOversight(requested);
  if (!clubEvent) {
    return <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to work out attendance points." />;
  }
  if (!allowed) {
    return <AccessRestricted title="Attendance points are restricted" detail="Attendance points are for event administrators and the Clubs Administrator." whoToAsk="your event administrator" />;
  }
  const actor: AttendancePointsActor = { kind: "staff", userId: user.id };
  let state: Awaited<ReturnType<typeof loadAttendancePointsView>>;
  try {
    state = await loadAttendancePointsView(event.id, actor);
  } catch (error) {
    if (!(error instanceof AttendancePointsError)) logError("Attendance points page read failed", error, { eventId: event.id });
    return (
      <section className="page-stack">
        <div className="panel page-stack">
          <h2>Attendance points</h2>
          <p>{error instanceof AttendancePointsError ? "This event is archived, so Attendance points can't be changed." : "Attendance points couldn't be loaded right now."}</p>
          <p className="field-help">Pick another club event from the event menu, or <Link href="/more">go back to More</Link> and try again.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="page-stack">
      <div className="panel page-stack">
        <h2>Attendance points<br /><span translate="no">{event.name}</span></h2>
        <p className="field-help">
          An optional tool. Turn it on to give clubs points for attending this event, using the rules the Area Coordinators voted on. After the event, review who counted for each club, then apply the points.
          Area Coordinators can turn it on and set the points too; only the Clubs Administrator or event administrators see names, override a club and apply or undo. Turning it off hides it and keeps what was set up.
        </p>
        <AttendancePointsWorkspace endpoint={`/api/events/${encodeURIComponent(event.id)}/attendance-points`} initial={state} />
      </div>
    </section>
  );
}
