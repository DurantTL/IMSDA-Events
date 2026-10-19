import type { Metadata } from "next";
import { StaffPageHeader } from "@/components/staff-page-header";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EventFeaturesTable } from "@/components/event-features-table";
import { buildMoreDirectoryCards, staffPageTitles } from "@/components/staff-navigation";
import { moduleRequestsEnabled } from "@/components/more-launcher-model";
import { resolveStaffViewer } from "@/modules/club-forms/access";
import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";
import { loadEventFeatureFacts } from "@/modules/event-features/repository";
import { buildFeatureRows } from "@/modules/event-features/model";
import { moduleState } from "@/modules/event-modules/service";
import { getEventSettings } from "@/modules/events/repository";
import { AccessRestricted } from "@/components/access-restricted";
import { resolveEventContext } from "@/modules/events/selection";
import { getGeneralLinkSettings } from "@/modules/general-link-registrations/repository";

/**
 * `/more/features` is the Event features page (#965): every feature an event can
 * have on or off, in one table, with its state, its switch where one exists and a
 * Settings link. It reads the same data the pages that already own each switch
 * read, and each switch sends the request that page sends, so who may change what
 * is unchanged: modules and the public calendar are system administrators', event
 * columns, the general link, teams and publishing follow event settings access,
 * all checked again on the server. Staff without the permission see the state
 * and no switch. Any staff member on the event may open it, like the Event
 * modules page at `/more`.
 */
export const metadata: Metadata = { title: staffPageTitles.eventFeatures };

export default async function EventFeaturesPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions, user } = await resolveEventContext(requested);
  // Event data needs the event view permission; kitchen staff (#1029) hold only the kitchen counts permission.
  if (!permissions.includes("VIEW_EVENT")) {
    return <AccessRestricted title="Event features are restricted" detail="Your event role does not include this page." />;
  }
  const { allowed: clubOversight, clubEvent } = await resolveClubOversight(event.id);
  const isSystemAdmin = user.globalRole === "SYSTEM_ADMIN";
  const eventQuery = `?event=${event.id}`;
  const canConfigure = permissions.includes("CONFIGURE_EVENT");

  const settings = await getEventSettings(event.id);
  if (!settings) notFound();
  const [state, facts, generalLink, teamSettings, clubFormsAccess] = await Promise.all([
    moduleState(event.id),
    loadEventFeatureFacts(event.id),
    clubEvent ? getGeneralLinkSettings(event.id) : Promise.resolve(null),
    clubEvent ? getTeamSettings(event.id) : Promise.resolve(null),
    resolveStaffViewer(),
  ]);

  // The cards (with each one's own permission result) give the Settings links of modules, lodging and meals.
  const cards = buildMoreDirectoryCards({
    permissions,
    clubOversight,
    clubEvent,
    isSystemAdmin,
    clubFormsAccess: Boolean(clubFormsAccess),
    eventQuery,
  });

  const rows = buildFeatureRows({
    audience: clubEvent ? "CLUB" : "GENERAL",
    eventQuery,
    isSystemAdmin,
    permissions,
    flags: {
      waitlistEnabled: settings.waitlistEnabled,
      autoPromoteWaitlist: settings.autoPromoteWaitlist,
      collectsShirtSizes: settings.collectsShirtSizes,
      hostedPaymentLinkEnabled: settings.hostedPaymentLinkEnabled,
      checksAdultBackgrounds: settings.checksAdultBackgrounds,
      isPublished: settings.isPublished,
      showOnCalendar: facts.showOnCalendar,
    },
    modules: { stored: state.stored, effective: state.effective, dataPresent: state.dataPresent, dataForced: state.dataForced },
    cards,
    generalLink: generalLink ? { enabled: generalLink.enabled, eligible: generalLink.eligible, problem: generalLink.problem } : null,
    teamsEnabled: teamSettings?.allowMultipleTeams ?? false,
    lodgingSetUp: facts.lodgingSetUp,
    mealsSetUp: facts.mealsSetUp,
    moduleRequestsEnabled,
  });

  return (
    <section className="page-stack event-features-page">
      {/* The one cross-link to /more. A button-styled link, which the phone audit measures at 44px (a bare link in a paragraph is 19px tall). */}
      <StaffPageHeader
        description={`Turn features on or off for ${event.name}.`}
        primary={<Link className="secondary-button" href={`/more${eventQuery}`}>Module requests and recent activity</Link>}
      />
      <p className="quiet-copy">
        A switch changes only whether the feature is used. Turning one off never deletes its data.
        {!isSystemAdmin && " A system administrator turns modules and the public calendar on or off."}
        {!canConfigure && " You can see each feature's state but not change it."}
      </p>
      <section className="panel" aria-label="Event features">
        <EventFeaturesTable eventId={event.id} rows={rows} />
      </section>
    </section>
  );
}
