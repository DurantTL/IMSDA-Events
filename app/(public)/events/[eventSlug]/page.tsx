import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  BookOpenText,
  CalendarPlus,
  ExternalLink,
  FileDown,
  Megaphone,
  Paperclip,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { EventInfoCards } from "@/components/event-info-cards";
import {
  EventContentBlocks,
  EventHeroBanner,
  publicEventAssetUrl,
} from "@/components/event-content-blocks";
import { EventRefundPolicy } from "@/components/event-refund-policy";
import { EventEmbedFullLoad } from "@/components/event-embed-full-load";
import { sanitizedHtmlBySection } from "@/modules/events/content-html";
import { ClubDirectorSignInNotice } from "@/components/club-director-sign-in-notice";
import { EventCardTransition } from "@/components/event-card-transition";
import { eventViewTransitionName } from "@/modules/events/view-transition";
import { EventWhenWhere } from "@/components/event-when-where";
import { TranslateHint } from "@/components/translate-hint";
import { AutoEventHeader, AutoEventInfoCards } from "@/components/auto-event-info-cards";
import { getAutoEventInfoCards } from "@/modules/event-info-cards/repository";
import { contentBlocks, parseBlockData } from "@/modules/events/content-schemas";
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
      siteName: "IMSDA Events",
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

  // Resources sit above the fold, the way the tiles do on the current page;
  // prose reads below the registration options.
  const resourceSections = landing.contentSections.filter(
    (section) => section.kind === "RESOURCE_LINKS" && section.links.length > 0,
  );
  const proseSections = landing.contentSections.filter(
    (section) => section.kind === "RICH_TEXT" && section.body.trim().length > 0,
  );
  const heroSection = landing.contentSections.find((section) => section.kind === "HERO");
  // The banner only counts when it can draw: invalid banner data renders nothing, so the page keeps its own h1 then.
  const bannerShown = Boolean(heroSection && parseBlockData("HERO", heroSection.data));
  const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
  // The card on the homepage and calendar morphs into exactly one header element: the banner, else the header below (#1208).
  const cardTransitionName = eventViewTransitionName(landing.event.slug);
  const assetUrl = (assetId: string) => publicEventAssetUrl(landing.event.slug, assetId);
  // Auto-built info cards (#651) are for club events only; every other event's
  // page renders exactly as before, without even reading the card data.
  const autoCards = landing.event.audience === "CLUB"
    ? await getAutoEventInfoCards(eventSlug)
    : null;

  // A club event's auto "Need help?" card has only an email. The sidebar card stays unless it would add nothing: no support
  // contact of its own (or the same one as the auto card) (#1005).
  const supportContact = landing.event.supportContact?.trim() ?? "";
  const hideSidebarHelp = Boolean(autoCards?.help)
    && (supportContact === "" || supportContact.toLowerCase() === autoCards!.help!.email.trim().toLowerCase());
  const { lifecycle } = landing;
  // Registration paths (forms, the club general link, the group form) are listed only when one of them can be used now;
  // before opening, when full or closed the status block says so, once (#1205).
  const pathCount = landing.forms.length + (landing.generalLink ? 1 : 0) + (landing.groupRegistration ? 1 : 0);
  const showPaths = lifecycle.action === "REGISTER" && pathCount > 0;
  // One path: the status block's button goes straight to it and its card has no second button. Several: the button
  // jumps to the list and each card has its own, because choosing the right one is the point.
  const soleHref = pathCount === 1
    ? (landing.forms[0]?.href ?? landing.generalLink?.href ?? landing.groupRegistration?.href ?? null)
    : null;
  const cardCta = (href: string) => (
    pathCount > 1 ? (
      <Link className="public-event-form-cta" href={href}>
        {lifecycle.ctaLabel} <ArrowRight size={17} aria-hidden="true" />
      </Link>
    ) : null
  );
  const statusBlock = (
    <section className={`public-event-status-block is-${lifecycle.state.toLowerCase()}`} aria-labelledby="event-status-title">
      <h2 id="event-status-title">{lifecycle.statusLabel}</h2>
      <p>{lifecycle.detail}</p>
      {lifecycle.action === "REGISTER" && showPaths && (
        <Link className="primary-button public-event-status-action" href={soleHref ?? "#registration-options"}>
          {lifecycle.ctaLabel} <ArrowRight size={18} aria-hidden="true" />
        </Link>
      )}
      {lifecycle.action === "ADD_TO_CALENDAR" && (
        <a className="secondary-button public-event-status-action" href={`/events/${encodeURIComponent(landing.event.slug)}/event.ics`}>
          <CalendarPlus size={18} aria-hidden="true" /> {lifecycle.ctaLabel}
        </a>
      )}
    </section>
  );
  // On a club event the options come first, right under the director notice; the cards, resources and blocks follow (#1005).
  const optionsLayout = (
      <div className="public-event-layout is-single">
        <section className="public-event-main" aria-label="Registration and event information">
          {showPaths && (
            <div className="public-event-form-list" id="registration-options">
              <h2 className="public-event-paths-heading">{lifecycle.formsHeading}</h2>
              {landing.forms.map((form, index) => (
                <article className="public-event-form-card" key={form.id}>
                  <div className="public-event-form-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="public-event-form-copy">
                    <p className="public-registration-eyebrow">{form.audienceLabel}</p>
                    <h3>{form.title}</h3>
                    {form.differentiator && (
                      <p className="public-event-form-differentiator">{form.differentiator}</p>
                    )}
                    <p>{form.description}</p>
                    <ul aria-label={`${form.title} details`}>
                      {form.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                    </ul>
                  </div>
                  {cardCta(form.href)}
                </article>
              ))}
              {landing.generalLink && (
                <article className="public-event-form-card">
                  <div className="public-event-form-number" aria-hidden="true">{String(landing.forms.length + 1).padStart(2, "0")}</div>
                  <div className="public-event-form-copy">
                    <p className="public-registration-eyebrow">Club directors</p>
                    <h3>{landing.generalLink.title}</h3>
                    <p>No club account yet? Register a team here without signing in. There is no fee.</p>
                  </div>
                  {cardCta(landing.generalLink.href)}
                </article>
              )}
              {landing.groupRegistration && (
                <article className="public-event-form-card">
                  <div className="public-event-form-number" aria-hidden="true">{String(landing.forms.length + (landing.generalLink ? 2 : 1)).padStart(2, "0")}</div>
                  <div className="public-event-form-copy">
                    <p className="public-registration-eyebrow">{landing.groupRegistration.label}</p>
                    <h3>{landing.groupRegistration.title}</h3>
                    <p>Not part of a club? One contact can register several people, each with their own classes. You&apos;ll be billed after the event; there is no payment to make now.</p>
                  </div>
                  {cardCta(landing.groupRegistration.href)}
                </article>
              )}
            </div>
          )}

          <EventRefundPolicy policy={landing.event.refundPolicy} />

          {proseSections.map((section, sectionIndex) => (
            <section
              className="public-event-prose"
              aria-labelledby={`public-event-information-${sectionIndex}`}
              key={section.id}
            >
              <header className="public-event-content-heading">
                <span aria-hidden="true"><BookOpenText size={20} /></span>
                <div>
                  <p className="public-registration-eyebrow">Event information</p>
                  <h2 id={`public-event-information-${sectionIndex}`}>{section.title}</h2>
                </div>
              </header>
              {/* Blocks contain plain text, never markup. React escapes every
                  item, so authored event content cannot become an injection. */}
              <div className="public-event-prose-body">
                {contentBlocks(section.body).map((block, blockIndex) => {
                  if (block.kind === "UNORDERED_LIST") {
                    return (
                      <ul key={blockIndex}>
                        {block.items.map((item, itemIndex) => (
                          <li key={itemIndex}>{item}</li>
                        ))}
                      </ul>
                    );
                  }
                  if (block.kind === "ORDERED_LIST") {
                    return (
                      <ol key={blockIndex}>
                        {block.items.map((item, itemIndex) => (
                          <li value={item.value} key={itemIndex}>{item.text}</li>
                        ))}
                      </ol>
                    );
                  }
                  return <p key={blockIndex}>{block.text}</p>;
                })}
              </div>
            </section>
          ))}
        </section>
      </div>
  );

  // Help and contact: a quiet section at the end of the page (#1205). A club event's auto "Need help?" card already
  // carries the same contact, so the section drops it then (#1005).
  const helpSection = (!hideSidebarHelp || landing.links.detailsUrl) ? (
    <section className="public-event-help-section" aria-labelledby="public-event-help-title">
      <h2 id="public-event-help-title">Need help?</h2>
      {!hideSidebarHelp && (
        <>
          <p>Questions about lodging, accessibility, fees, or which form to use? Contact the event team.</p>
          {landing.event.supportContact && (
            <p><strong className="public-event-support-contact">{landing.event.supportContact}</strong></p>
          )}
          <a href={landing.links.supportUrl}>Contact IMSDA <ExternalLink size={15} aria-hidden="true" /></a>
        </>
      )}
      {landing.links.detailsUrl && (
        <a href={landing.links.detailsUrl}>Schedule, speakers, and full details on imsda.org <ExternalLink size={15} aria-hidden="true" /></a>
      )}
    </section>
  ) : null;

  return (
    <main className="public-registration-page public-event-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <Link className="public-registration-brand public-event-brand-link" href="/">
            <BrandMark />
            <span><strong>IMSDA</strong><small>Events</small></span>
          </Link>
          <div className="public-header-links">
            {landing.links.detailsUrl && (
              <a className="public-event-details-link" href={landing.links.detailsUrl}>
                Back to full event details <ExternalLink size={15} aria-hidden="true" />
              </a>
            )}
            <PublicHeaderSessionLinks />
          </div>
        </div>
      </header>
      <TranslateHint />

      {/* One container (#720): every section below shares this width and left
          edge at every viewport, with the same side gutters on a phone. */}
      <div className="public-event-container">
      {/* The header banner (#816) comes first and owns the page's h1. With one, the event
          header below is a plain details row with no second title or hero (#1004); without
          a banner nothing changes. */}
      {heroSection && bannerShown && <EventCardTransition name={cardTransitionName}><EventHeroBanner section={heroSection} assetUrl={assetUrl} /></EventCardTransition>}
      {autoCards ? (
        <EventCardTransition name={bannerShown ? null : cardTransitionName}>
        <AutoEventHeader
          header={autoCards.header}
          dateLabel={landing.event.dateLabel}
          timeLabel={landing.event.timeLabel}
          location={landing.event.location}
          titleMode={!bannerShown ? "h1" : sameName(heroSection!.title, autoCards.header.title) ? "hidden" : "text"}
        />
        </EventCardTransition>
      ) : bannerShown ? (
        <section className="public-event-facts" aria-label="Event details">
          {/* The banner's title is free text; when it is not the event's name, the name still appears once, as text. */}
          {!sameName(heroSection!.title, landing.event.name) && <p className="public-event-facts-name">{landing.event.name}</p>}
          <EventWhenWhere dateLabel={landing.event.dateLabel} timeLabel={landing.event.timeLabel} location={landing.event.location} />
        </section>
      ) : (
        <EventCardTransition name={cardTransitionName}>
        <section className="public-registration-hero public-event-hero">
          <div>
            <p className="public-registration-eyebrow">Iowa-Missouri Conference event</p>
            <h1>{landing.event.name}</h1>
            <EventWhenWhere dateLabel={landing.event.dateLabel} timeLabel={landing.event.timeLabel} location={landing.event.location} />
          </div>
        </section>
        </EventCardTransition>
      )}

      {statusBlock}

      <ClubDirectorSignInNotice
        event={{
          audience: landing.event.audience,
          slug: landing.event.slug,
          registrationOpen: lifecycle.ctaEnabled,
          hasClubPortalForm: landing.forms.some((form) => form.registrationPath === "CLUB_PORTAL"),
        }}
      />

      {autoCards && optionsLayout}

      {landing.announcements.length > 0 && (
        <section
          className="public-event-announcement-feed"
          aria-labelledby="public-event-updates-title"
        >
          <header className="public-event-announcement-heading">
            <span aria-hidden="true"><Megaphone size={20} /></span>
            <div>
              <p className="public-registration-eyebrow">Attendee feed</p>
              <h2 id="public-event-updates-title">Event updates</h2>
            </div>
          </header>
          <ul className="public-event-announcement-list">
            {landing.announcements.map((announcement, index) => {
              const headingId = `public-event-announcement-${index}`;
              return (
                <li key={`${announcement.publishedAt}:${announcement.title}:${index}`}>
                  <article
                    className={[
                      "public-event-announcement",
                      `is-${announcement.priority.toLowerCase()}`,
                      announcement.isFeatured ? "is-featured" : "",
                    ].filter(Boolean).join(" ")}
                    aria-labelledby={headingId}
                  >
                    <div className="public-event-announcement-meta">
                      <span className="public-event-announcement-priority">
                        {announcement.priorityLabel}
                      </span>
                      <span>{announcement.placementLabel}</span>
                      <time dateTime={announcement.publishedAt}>
                        Published {announcement.publishedLabel}
                      </time>
                    </div>
                    <h3 id={headingId}>{announcement.title}</h3>
                    <p>{announcement.body}</p>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <EventInfoCards sections={landing.contentSections} eventSlug={landing.event.slug} placement="page" />

      {resourceSections.map((section, sectionIndex) => {
        const headingId = `public-event-resources-${sectionIndex}`;
        return (
          <section
            className="public-event-resources"
            aria-labelledby={headingId}
            key={section.id}
          >
            <header className="public-event-content-heading">
              <span aria-hidden="true"><Paperclip size={20} /></span>
              <div>
                <p className="public-registration-eyebrow">Event resources</p>
                <h2 id={headingId}>{section.title}</h2>
              </div>
            </header>
            <ul>
              {section.links.map((link, linkIndex) => (
                <li key={`${section.id}:${linkIndex}`}>
                  {/* An uploaded file is served from here; anything else is
                      off-site, so it gets the usual untrusted-target guards. */}
                  <a
                    href={link.assetId
                      ? `/api/public/events/${encodeURIComponent(landing.event.slug)}/assets/${encodeURIComponent(link.assetId)}`
                      : link.url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="public-event-resource-icon" aria-hidden="true">
                      {link.assetId ? <FileDown size={19} /> : <ExternalLink size={18} />}
                    </span>
                    <span>
                      <strong>{link.label}</strong>
                      {link.description && <small>{link.description}</small>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {autoCards && <AutoEventInfoCards cards={autoCards} />}

      {/* The #816 blocks, in the order staff set them. Custom HTML is
          sanitized again here, at render, whatever was stored. */}
      <EventContentBlocks
        sections={landing.contentSections}
        placement="page"
        assetUrl={assetUrl}
        event={landing.event}
        nowMs={landing.renderedAtMs}
        sanitizedHtml={sanitizedHtmlBySection(landing.contentSections)}
      />
      {/* The frames' Content-Security-Policy applies only to a full page load. */}
      {landing.contentSections.some((section) => section.kind === "EMBED" && section.placement !== "REGISTRATION_FORM") && (
        <EventEmbedFullLoad />
      )}

      {!autoCards && optionsLayout}

      {helpSection}
      </div>
    </main>
  );
}
