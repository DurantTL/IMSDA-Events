import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { eventSlugFromHref, eventTransitionNames } from "@/modules/events/view-transition";
import { EventPhotoCard, eventCardImage } from "@/components/event-photo-card";
import { StartAClubCallout } from "@/components/start-a-club-callout";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { addDays, firstPerSeries } from "@/modules/calendar/domain";
import { conferenceToday, listPublicCalendarItems } from "@/modules/calendar/repository";
import { homeFeaturedLimit, featuredItemsFor, withoutFeatured } from "@/modules/events/featured-domain";
import { listEventCardImages, listFeaturedEventRows } from "@/modules/events/featured";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "IMSDA Events",
  description: "Register for Iowa-Missouri Conference events, manage your club, and see the conference calendar.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

const upcomingLimit = 6;

/**
 * The public front door (#373). Members, club leaders, and visitors start
 * here. The header offers Sign in (#1009).
 */
export default async function Home() {
  const today = conferenceToday();
  const [items, attendee, featuredRows] = await Promise.all([
    listPublicCalendarItems(today, addDays(today, 365)),
    getCurrentAttendee(),
    listFeaturedEventRows(today, homeFeaturedLimit),
  ]);
  // Featured events lead the page as larger cards (#1218) and are left out of "Coming up", so no card shows twice.
  const featured = featuredItemsFor(items, featuredRows);
  const upcoming = withoutFeatured(firstPerSeries(items), featured).slice(0, upcomingLimit);
  const cardImages = await listEventCardImages([...featured, ...upcoming].flatMap((item) => {
    const slug = eventSlugFromHref(item.href);
    return slug ? [slug] : [];
  }));
  const usedNames = new Set<string>();
  const featuredNames = eventTransitionNames(featured, usedNames);
  const cardNames = eventTransitionNames(upcoming, usedNames);
  const signedInName = attendee.account?.displayName || attendee.account?.verifiedEmail;

  return (
    <main className="public-registration-page public-calendar-page public-home-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <Link className="public-registration-brand public-event-brand-link" href="/">
            <BrandMark />
            <span><strong>IMSDA</strong><small>Events</small></span>
          </Link>
          <div className="public-header-links"><PublicHeaderSessionLinks /></div>
        </div>
      </header>

      <section className="public-registration-hero calendar-hero public-home-banner">
        <div>
          <p className="public-registration-eyebrow">Iowa-Missouri Conference</p>
          <h1>Events and registration</h1>
        </div>
      </section>

      <div className="calendar-layout">
        {featured.length > 0 && (
          <section aria-labelledby="home-featured-heading" className="event-featured">
            <h2 id="home-featured-heading">Featured</h2>
            <ul aria-labelledby="home-featured-heading" className="event-featured-list">
              {featured.map((item) => (
                <EventPhotoCard image={eventCardImage(item, cardImages)} item={item} key={item.key} transitionName={featuredNames.get(item.key)} variant="featured" />
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="home-upcoming-heading" className="calendar-agenda event-photo-strip">
          <div className="event-photo-strip-head">
            <h2 id="home-upcoming-heading">Coming up</h2>
            <Link className="event-photo-see-all" href="/calendar?view=list">See all <ChevronRight size={16} aria-hidden="true" /></Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="calendar-empty">{featured.length > 0 ? "Everything coming up is featured above." : "Nothing is on the calendar yet. Check back soon."}</p>
          ) : (
            <ul aria-labelledby="home-upcoming-heading" className="event-photo-list">
              {upcoming.map((item) => <EventPhotoCard image={eventCardImage(item, cardImages)} item={item} key={item.key} transitionName={cardNames.get(item.key)} />)}
            </ul>
          )}
          <p className="home-more">
            <Link className="primary-button home-calendar-button" href="/calendar?view=list">
              <CalendarDays size={18} aria-hidden="true" /> See the full calendar
            </Link>
          </p>
        </section>

        <nav aria-label="Get started" className="home-links">
          <ul>
            <li>
              <Link href="/account">
                <span>
                  <strong>My registrations</strong>
                  {signedInName && <small>Signed in as {signedInName}</small>}
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            </li>
            <li>
              <Link href="/account/clubs">
                <span><strong>My club</strong></span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            </li>
            <li>
              {/* A full page load, not a client-side <Link>: /clubs is the only
                  page whose Content-Security-Policy admits the map tiles, and a
                  soft navigation would keep this page's policy. */}
              <a href="/clubs">
                <span><strong>Find a club</strong></span>
                <ChevronRight size={18} aria-hidden="true" />
              </a>
            </li>
          </ul>
        </nav>

        <StartAClubCallout variant="line" />
      </div>
    </main>
  );
}
