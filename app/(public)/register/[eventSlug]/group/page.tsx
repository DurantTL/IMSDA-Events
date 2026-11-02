import { PublicMetricsBeacon } from "@/components/public-metrics-beacon";
import { securityCheckConfigForPage } from "@/modules/security/security-check-config";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { BrandLink } from "@/components/brand-link";
import { EventInfoCards } from "@/components/event-info-cards";
import { EventContentBlocks, publicEventAssetUrl } from "@/components/event-content-blocks";
import { GroupRegistrationFlow } from "@/components/group-registration-flow";
import { listPublishedRegistrationInfoCards } from "@/modules/events/content-repository";
import { GROUP_LABEL } from "@/modules/group-registrations/domain";
import { GroupRegistrationError, getGroupRegistrationExperience } from "@/modules/group-registrations/repository";

export const dynamic = "force-dynamic";

type GroupRegistrationPageProps = { params: Promise<{ eventSlug: string }> };

export async function generateMetadata({ params }: GroupRegistrationPageProps): Promise<Metadata> {
  const { eventSlug } = await params;
  // The page calls notFound() when the event has no group experience, so the tab title says so.
  const experience = await load(eventSlug);
  return {
    title: experience ? `${GROUP_LABEL} registration` : "Page not found",
    robots: { index: false, follow: false },
  };
}

const load = cache(async (eventSlug: string) => {
  try {
    return await getGroupRegistrationExperience(eventSlug);
  } catch (error) {
    if (error instanceof GroupRegistrationError && error.code === "EVENT_NOT_FOUND") return null;
    throw error;
  }
});

/**
 * /register/<eventSlug>/group (#650): people who are not in a club register
 * through one contact, on a club event. Labelled only "Group". No payment: the
 * contact is billed after the event.
 */
export default async function GroupRegistrationPage({ params }: GroupRegistrationPageProps) {
  const { eventSlug } = await params;
  const experience = await load(eventSlug);
  if (!experience) notFound();
  if (experience.problem || !experience.event || !experience.experience) {
    return (
      <main className="public-registration-page">
        <header className="public-registration-header">
          <div className="public-registration-header-inner">
            <BrandLink className="public-registration-brand public-event-brand-link" wordmark />
          </div>
        </header>
        <section className="public-manage-card public-group-state">
          <p className="public-registration-eyebrow">{GROUP_LABEL}</p>
          <h1>{GROUP_LABEL} registration isn&apos;t available yet</h1>
          <p>The event team hasn&apos;t finished setting up {GROUP_LABEL.toLowerCase()} registration. Please check back soon, or contact the event team.</p>
          <p><Link className="public-event-not-found-link" href={`/events/${encodeURIComponent(eventSlug)}`}>Back to the event</Link></p>
        </section>
      </main>
    );
  }
  if (experience.experience.lifecycle.phase !== "OPEN" || experience.experience.lifecycle.capacityDecision === "FULL") {
    redirect(`/events/${encodeURIComponent(eventSlug)}`);
  }
  const editableCards = await listPublishedRegistrationInfoCards(eventSlug);
  return (
    <>
    <PublicMetricsBeacon hits={[{ metric: "REGISTRATION_START", dimension: eventSlug }]} />
    <GroupRegistrationFlow
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
      ready={{
        ...experience,
        event: experience.event,
        experience: experience.experience,
        billingNotice: experience.billingNotice ?? "You'll be billed after the event.",
      }}
    />
    </>
  );
}
