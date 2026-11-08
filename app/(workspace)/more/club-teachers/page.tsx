import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { ClubTeachersPanel } from "@/components/club-teachers-panel";
import { ClubTeachersSummary } from "@/components/club-teachers-summary";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { staffPageTitles } from "@/components/staff-navigation";
import { logError } from "@/lib/logger";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";
import { ClubTeacherError } from "@/modules/club-teachers/repository";
import { loadTeacherToolState } from "@/modules/club-teachers/settings";
import { loadTeacherSummary } from "@/modules/club-teachers/summary";

export const metadata: Metadata = { title: staffPageTitles.clubTeachers };
export const dynamic = "force-dynamic";

/**
 * Staff screen for the optional Club teachers tool (#1681): the switch, the rule, and teachers per weekend or site and
 * per club. For a system administrator, an Event Admin or the Clubs Administrator, the people `resolveClubOversight`
 * admits. It also works on a club event that is not published yet.
 */
export default async function ClubTeachersPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const requested = (await searchParams).event;
  const { event, allowed, clubEvent } = await resolveClubOversight(requested);
  if (!clubEvent) {
    return <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to ask clubs who is teaching." />;
  }
  if (!allowed) {
    return <AccessRestricted title="Club teachers is restricted" detail="Turning on Club teachers is for event administrators and the Clubs Administrator." whoToAsk="your event administrator" />;
  }
  let loaded: Awaited<ReturnType<typeof loadTeacherToolState>>;
  let summary: Awaited<ReturnType<typeof loadTeacherSummary>>;
  try {
    [loaded, summary] = await Promise.all([loadTeacherToolState(event.id, "staff"), loadTeacherSummary(event.id)]);
  } catch (error) {
    if (!(error instanceof ClubTeacherError)) logError("Club teachers page read failed", error, { eventId: event.id });
    return (
      <section className="page-stack">
        <div className="panel page-stack">
          <h2>Club teachers</h2>
          <p>{error instanceof ClubTeacherError ? "This event is archived, so Club teachers can't be changed." : "Club teachers couldn't be loaded right now."}</p>
          <p className="field-help">Pick another club event from the event menu, or <Link href="/more">go back to More</Link> and try again.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="page-stack">
      <div className="panel page-stack">
        <h2>Club teachers<br /><span translate="no">{event.name}</span></h2>
        <p className="field-help">
          An optional tool for Honors Weekend. Turn it on to ask each club who from the club is teaching. Clubs see the step only while it is on and a rule is saved.
          Area Coordinators can turn it on too, but only you can require it before a club submits. Turning it off hides it and keeps what clubs entered.
        </p>
        <ClubTeachersPanel canRequire endpoint={`/api/events/${encodeURIComponent(event.id)}/club-teachers`} initial={{ enabled: loaded.enabled, rule: loaded.rule }} />
      </div>
      <div className="panel page-stack">
        <ClubTeachersSummary instructorsHref={`/more/honors/instructors?event=${encodeURIComponent(event.id)}`} summary={summary} />
      </div>
    </section>
  );
}
