import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { BaptismFollowUpList } from "@/components/baptism-follow-up-list";
import { BaptismFollowUpPanel } from "@/components/baptism-follow-up-panel";
import { BaptismFollowUpSwitch } from "@/components/baptism-follow-up-switch";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { logError } from "@/lib/logger";
import { recordBaptismListViewed } from "@/modules/baptism-follow-up/follow-up";
import { BaptismFollowUpError, loadBaptismFollowUpPage } from "@/modules/baptism-follow-up/settings";
import { assertScopedToggleAllowed, requireAreaCoordinatorToggleActor } from "@/modules/event-modules/scoped-toggle";
import { BAPTISM_FOLLOW_UP_MODULE_KEY } from "@/modules/baptism-follow-up/domain";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Baptism follow-up", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Baptism follow-up for one published club event (#1680), for an Area Coordinator: the switch, the event lead addresses and, when
 * it is on, the names with each one's followed-up status and note. Opening the names is audited (the count, never a name).
 * Staff acting as a coordinator (#442) see a view-only note and no names.
 */
export default async function AreaBaptismFollowUpPage({ params }: { params: Promise<{ eventId: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const { eventId } = await params;
  const account = await currentAreaCoordinator();
  const loaded = account
    ? await (async () => {
      const actor = await requireAreaCoordinatorToggleActor();
      await assertScopedToggleAllowed(BAPTISM_FOLLOW_UP_MODULE_KEY, actor);
      const state = await loadBaptismFollowUpPage(eventId, "area-coordinator");
      if (state.enabled) await recordBaptismListViewed(actor, eventId, state.clubs.reduce((sum, club) => sum + club.names.length, 0));
      return { state, eventName: state.eventName };
    })().catch((error: unknown) => {
      if (error instanceof BaptismFollowUpError && error.code === "EVENT_NOT_FOUND") return "missing" as const;
      logError("Coordinator baptism follow-up read failed", error, { eventId });
      return null;
    })
    : "view-only" as const;
  if (loaded === "missing") notFound();
  const endpoint = `/api/attendee/area-clubs/events/${encodeURIComponent(eventId)}/baptism-follow-up`;
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <BackLink href="/account/area-clubs/events">Back to club events</BackLink>
      {loaded === null ? (
        <CoordinatorUnavailable what="Baptism follow-up" />
      ) : loaded === "view-only" ? (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Baptism follow-up</h2>
          </div>
          <p className="field-help">Only an Area Coordinator signed in with their own account can use this tool.</p>
        </>
      ) : (
        <>
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Club coordination</p>
            <h2>Baptism follow-up<br /><span translate="no">{loaded.eventName}</span></h2>
          </div>
          <p className="field-help">
            An optional tool. When a club names someone for baptism on its registration, the event lead and the club&apos;s church pastor each get one short email with the name, the club,
            the event and its dates, asking them to follow up. Each name is sent once. You can then mark each name followed up and keep a note with it. Opening the names is recorded.
          </p>
          {loaded.state.enabled ? (
            <>
              <p className="field-help" role="status">Baptism follow-up is on for this event.</p>
              <BaptismFollowUpPanel endpoint={endpoint} initialEmails={loaded.state.leadEmails} />
              {loaded.state.leadEmails.length === 0 && <p className="field-help">No event lead is set, so no notices are sent. Add an address above.</p>}
              <BaptismFollowUpSwitch enabled endpoint={endpoint} />
              <h3>Names passed on</h3>
              <BaptismFollowUpList canAddPastor={false} clubs={loaded.state.clubs} statusEndpoint={endpoint} />
            </>
          ) : (
            <>
              <p className="field-help" role="status">Baptism follow-up is off for this event, so no notices are sent.</p>
              <BaptismFollowUpSwitch enabled={false} endpoint={endpoint} />
            </>
          )}
        </>
      )}
    </section>
  );
}
