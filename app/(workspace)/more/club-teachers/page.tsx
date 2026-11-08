import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { ClubTeachersPanel } from "@/components/club-teachers-panel";
import { ClubTeachersSummary } from "@/components/club-teachers-summary";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { staffPageTitles } from "@/components/staff-navigation";
import { canManageClubAssignments } from "@/modules/club-registrations/assignments-access";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";
import { loadTeacherToolState } from "@/modules/club-teachers/settings";
import { loadTeacherSummary } from "@/modules/club-teachers/summary";
import { resolveEventContext } from "@/modules/events/selection";

export const metadata: Metadata = { title: staffPageTitles.clubTeachers };
export const dynamic = "force-dynamic";

/** Staff screen for the optional Club teachers tool (#1681): the switch, the rule, and teachers per weekend or site and per club. */
export default async function ClubTeachersPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const requested = (await searchParams).event;
  const { event, permissions } = await resolveEventContext(requested);
  if (!canManageClubAssignments(permissions)) {
    return <AccessRestricted title="Club teachers is restricted" detail="Turning on Club teachers needs registration-management access." whoToAsk="your event administrator" />;
  }
  const { clubEvent } = await resolveClubOversight(event.id);
  if (!clubEvent) {
    return <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to ask clubs who is teaching." />;
  }
  const [state, summary] = await Promise.all([loadTeacherToolState(event.id), loadTeacherSummary(event.id)]);
  return (
    <section className="page-stack">
      <div className="panel page-stack">
        <h2>Club teachers: <span translate="no">{event.name}</span></h2>
        <p className="field-help">
          An optional tool for Honors Weekend. Turn it on to ask each club who from the club is teaching. Clubs see the step only while it is on and a rule is saved.
          Area Coordinators can turn it on too. Turning it off hides it and keeps what clubs entered.
        </p>
        <ClubTeachersPanel endpoint={`/api/events/${encodeURIComponent(event.id)}/club-teachers`} initial={{ enabled: state.enabled, rule: state.rule }} />
      </div>
      <div className="panel page-stack">
        <ClubTeachersSummary instructorsHref={`/more/honors/instructors?event=${encodeURIComponent(event.id)}`} summary={summary} />
      </div>
    </section>
  );
}
