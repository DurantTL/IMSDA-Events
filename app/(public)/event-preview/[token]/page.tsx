import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicEventLandingView } from "@/components/public-event-landing-view";
import { getAutoEventInfoCards } from "@/modules/event-info-cards/repository";
import { getEventPreviewLanding } from "@/modules/events/public-repository";
import { findPreviewLinkByToken } from "@/modules/events/preview-link-repository";
import { getPublishedHubContent } from "@/modules/site-content/hub-content";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import styles from "./event-preview.module.css";

/** A private preview of an event page, drafts included (#1514). Never cached, never indexed. */
export const dynamic = "force-dynamic";

type PreviewPageProps = { params: Promise<{ token: string }> };

export const metadata: Metadata = {
  title: "Event page preview",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

function expiryLabel(expiresAt: Date) {
  return formatInConferenceTime(expiresAt, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function EventPreviewPage({ params }: PreviewPageProps) {
  const { token } = await params;
  const link = await findPreviewLinkByToken(token);
  if (!link) notFound();
  const landing = await getEventPreviewLanding(link.eventId);
  if (!landing) notFound();
  const hubContent = await getPublishedHubContent();
  const autoCards = landing.event.audience === "CLUB" ? await getAutoEventInfoCards(landing.event.slug) : null;
  const draftTitles = landing.contentSections.filter((section) => !section.isPublished).map((section) => section.title);
  const assetBase = `/api/public/event-preview/${encodeURIComponent(token)}/assets`;
  return (
    <PublicEventLandingView
      landing={landing}
      hubContent={hubContent}
      autoCards={autoCards}
      assetUrl={(assetId) => `${assetBase}/${encodeURIComponent(assetId)}`}
      preview
      banner={(
        <p className={styles.banner} role="status">
          <strong>Preview</strong> — includes changes that are not published yet; this link expires {expiryLabel(link.expiresAt)}
          {draftTitles.length > 0 && <> Not published yet: {draftTitles.join(", ")}.</>}
        </p>
      )}
    />
  );
}
