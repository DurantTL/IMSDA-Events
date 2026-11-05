import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListChecks } from "lucide-react";
import { CoordinatorBanner } from "@/components/coordinator-banner";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { CoordinatorShellHeader } from "@/components/coordinator-shell-header";
import { EmptyState } from "@/components/empty-state";
import { getPrisma } from "@/lib/prisma";
import { listWaitingClubsForCoordinator } from "@/modules/event-locations/waitlist";
import { currentAreaCoordinator, requireSecondStepForAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export const metadata: Metadata = { title: "Waitlists", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * The clubs waitlisted at each location an Area Coordinator coordinates (#599),
 * in each location's own first-come order. View only: promotion happens when a
 * seat opens, or by event staff.
 */
export default async function AreaWaitlistsPage() {
  const coordinator = await currentAreaCoordinator();
  if (!coordinator) {
    // Sent to the club gate when the second step is what is missing (#1410), otherwise there is nothing here.
    await requireSecondStepForAreaCoordinator();
    notFound();
  }
  const locations = await listWaitingClubsForCoordinator(getPrisma(), coordinator.id);
  const withClubs = locations.filter((location) => location.clubs.length > 0);

  return (
    <>
      <CoordinatorShellHeader>
        <CoordinatorBanner />
      </CoordinatorShellHeader>
      <div className="account-page-body">
        <section className="public-manage-card">
          <CoordinatorSectionHeading eyebrow="Club coordination" title="Waitlists">
            <p>Clubs waiting for a seat at the event locations you coordinate, in first-come order. View only.</p>
          </CoordinatorSectionHeading>
          {locations.length === 0 ? (
            <EmptyState
              action={{ label: "Open Help guides", href: "/account/help" }}
              actionClass="secondary-button"
              announce={false}
              canCreate
              icon={<ListChecks size={20} aria-hidden="true" />}
              title="You aren't set as a location coordinator yet"
            >
              Waitlists appear here for each event location you coordinate. Event staff choose the coordinator for each location, so ask them to add you.
            </EmptyState>
          ) : withClubs.length === 0 ? (
            <EmptyState
              action={{ label: "Back to Overview", href: "/account/area-clubs/overview" }}
              actionClass="secondary-button"
              announce={false}
              canCreate
              icon={<ListChecks size={20} aria-hidden="true" />}
              title="No clubs are waiting right now"
            >
              A club joins a waitlist when a location fills up. Check back after that happens; this page needs nothing from you until then.
            </EmptyState>
          ) : (
            withClubs.map((location) => (
              <div key={location.locationId}>
                <h3 translate="no">{location.locationName}</h3>
                <p className="field-help" translate="no">{location.eventName}</p>
                <ol className="public-manage-club-list">
                  {location.clubs.map((club) => (
                    <li key={club.registrationId}>
                      <span>
                        <strong translate="no">#{club.place} · {club.clubName}</strong>
                        <small>
                          {club.attendeeCount} {club.attendeeCount === 1 ? "person" : "people"} · joined{" "}
                          {formatInConferenceTime(club.joinedAt, { dateStyle: "medium" })}
                        </small>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))
          )}
        </section>
      </div>
    </>
  );
}
