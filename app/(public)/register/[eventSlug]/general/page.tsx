import { PublicMetricsBeacon } from "@/components/public-metrics-beacon";
import { securityCheckConfigForPage } from "@/modules/security/security-check-config";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { BrandLink } from "@/components/brand-link";
import { EventInfoCards } from "@/components/event-info-cards";
import { EventContentBlocks, publicEventAssetUrl } from "@/components/event-content-blocks";
import { GeneralLinkRegistrationFlow } from "@/components/general-link-registration-flow";
import { listPublishedRegistrationInfoCards } from "@/modules/events/content-repository";
import { GeneralLinkError, getGeneralLinkExperience } from "@/modules/general-link-registrations/repository";

export const dynamic = "force-dynamic";

type GeneralLinkPageProps = { params: Promise<{ eventSlug: string }> };

const load = cache(async (eventSlug: string) => {
  try {
    return await getGeneralLinkExperience(eventSlug);
  } catch (error) {
    if (error instanceof GeneralLinkError && error.code === "EVENT_NOT_FOUND") return null;
    throw error;
  }
});

export async function generateMetadata({ params }: GeneralLinkPageProps): Promise<Metadata> {
  const { eventSlug } = await params;
  const loaded = await load(eventSlug);
  return {
    title: loaded ? `Team registration · ${loaded.event.name}` : "Page not found",
    robots: { index: false, follow: false },
  };
}

/**
 * /register/<eventSlug>/general (#931): the event's one public link for club directors with no account to register a team.
 * Not found unless staff turned the link on for a club event.
 */
export default async function GeneralLinkPage({ params }: GeneralLinkPageProps) {
  const { eventSlug } = await params;
  const loaded = await load(eventSlug);
  if (!loaded) notFound();
  if (loaded.problem || !loaded.experience) {
    return (
      <main className="public-registration-page">
        <header className="public-registration-header">
          <div className="public-registration-header-inner">
            <BrandLink className="public-registration-brand public-event-brand-link" wordmark />
          </div>
        </header>
        <section className="public-manage-card public-group-state">
          <p className="public-registration-eyebrow">Team registration</p>
          <h1>Team registration isn&apos;t available yet</h1>
          <p>The event team hasn&apos;t finished setting up this registration. Please check back soon, or contact the event team.</p>
          <p><Link className="public-event-not-found-link" href={`/events/${encodeURIComponent(eventSlug)}`}>Back to the event</Link></p>
        </section>
      </main>
    );
  }
  if (loaded.experience.lifecycle.phase !== "OPEN") redirect(`/events/${encodeURIComponent(eventSlug)}`);
  const editableCards = await listPublishedRegistrationInfoCards(eventSlug);
  return (
    <>
    <PublicMetricsBeacon hits={[{ metric: "REGISTRATION_START", dimension: eventSlug }]} />
    <GeneralLinkRegistrationFlow
      eventSlug={eventSlug}
      securityCheck={await securityCheckConfigForPage()}
      topContent={
        editableCards.length > 0
          ? (
            <>
              <EventInfoCards sections={editableCards} eventSlug={eventSlug} placement="registration" />
              <EventContentBlocks
                sections={editableCards}
                placement="registration"
                assetUrl={(assetId) => publicEventAssetUrl(eventSlug, assetId)}
                idPrefix="registration-block"
              />
            </>
          )
          : undefined
      }
      ready={{ ...loaded, experience: loaded.experience }}
    />
    </>
  );
}
