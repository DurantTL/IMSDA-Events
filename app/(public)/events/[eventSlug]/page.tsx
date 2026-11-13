import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicEventLandingView } from "@/components/public-event-landing-view";
import { publicEventAssetUrl } from "@/components/event-content-blocks";
import { getPublishedHubContent } from "@/modules/site-content/hub-content";
import { getAutoEventInfoCards } from "@/modules/event-info-cards/repository";
import { getPublicEventLanding } from "@/modules/events/public-repository";

export const dynamic = "force-dynamic";

type PublicEventPageProps = {
  params: Promise<{ eventSlug: string }>;
};

export async function generateMetadata({
  params,
}: PublicEventPageProps): Promise<Metadata> {
  const { eventSlug } = await params;
  const landing = await getPublicEventLanding(eventSlug);
  if (!landing) {
    return {
      title: "Event registration unavailable",
      description: "This IMSDA event registration page is not available.",
      robots: { index: false, follow: false },
    };
  }

  const description = `View details and choose a registration form for ${landing.event.name}, ${landing.event.dateLabel}.`;
  return {
    title: `${landing.event.name} registration`,
    description,
    alternates: {
      canonical: `/events/${encodeURIComponent(eventSlug)}`,
    },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${landing.event.name} registration`,
      description,
      type: "website",
      siteName: "IMAdventist",
      url: `/events/${encodeURIComponent(eventSlug)}`,
    },
  };
}

export default async function PublicEventPage({
  params,
}: PublicEventPageProps) {
  const { eventSlug } = await params;
  const landing = await getPublicEventLanding(eventSlug);
  if (!landing) notFound();
  const hubContent = await getPublishedHubContent();
  // Auto-built info cards (#651) are for club events only; every other event's
  // page renders exactly as before, without even reading the card data.
  const autoCards = landing.event.audience === "CLUB"
    ? await getAutoEventInfoCards(eventSlug)
    : null;
  return (
    <PublicEventLandingView
      landing={landing}
      hubContent={hubContent}
      autoCards={autoCards}
      assetUrl={(assetId) => publicEventAssetUrl(landing.event.slug, assetId)}
    />
  );
}
