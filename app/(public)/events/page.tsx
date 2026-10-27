import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronRight, MapPin } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { addDays, calendarItemStatusLine, formatDateRange, type CalendarItem } from "@/modules/calendar/domain";
import {
  openRegistrationFilters,
  openRegistrationHref,
  openRegistrationWindowDays,
  parseOpenRegistrationFilter,
  selectOpenRegistrationItems,
  type OpenRegistrationFilter,
} from "@/modules/calendar/open-registration";
import { conferenceToday, listPublicCalendarItems } from "@/modules/calendar/repository";
import { pinFeatured } from "@/modules/events/featured-domain";
import { listFeaturedEventRows } from "@/modules/events/featured";
import { clubRegistrationEntryPath } from "@/modules/club-registrations/entry-path";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";
import { listDirectedClubs } from "@/modules/organizations/director-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Open for registration",
  description: "Iowa-Missouri Conference events you can register for now or soon, for clubs and for everyone.",
  alternates: { canonical: "/events" },
  robots: { index: true, follow: true },
};

const filterLabels: Record<OpenRegistrationFilter, string> = { all: "All", clubs: "Club events", everyone: "Everyone" };
const emptyWording: Record<OpenRegistrationFilter, string> = {
  all: "No events are open for registration right now.",
  clubs: "No events are open for registration right now for clubs.",
  everyone: "No events are open for registration right now for everyone.",
};

/** Whether the signed-in visitor directs a club that may register for events; a failed lookup just shows the note. */
async function visitorRegistersClubs() {
  try {
    const { account } = await getCurrentAttendee();
    if (!account) return false;
    return (await listDirectedClubs(account.id)).some((club) => clubCapabilities(club.role).registerForEvents);
  } catch {
    return false;
  }
}

function EventCard({ item, directsClub, featured }: { item: CalendarItem; directsClub: boolean; featured: boolean }) {
  const statusLine = calendarItemStatusLine(item);
  const open = item.registrationStatus === "OPEN" || item.registrationStatus === "WAITLIST";
  return (
    <li className="open-events-card">
      {featured && <p aria-hidden="true" className="open-events-featured">Featured</p>}
      <h3><Link href={item.href!}>{featured && <span className="sr-only">Featured: </span>}{item.eventTitle ?? item.title}</Link></h3>
      <p className="calendar-agenda-meta">
        <span><CalendarDays size={14} aria-hidden="true" /> {formatDateRange(item.eventStartsOn ?? item.startsOn, item.eventEndsOn ?? item.endsOn)}</span>
        {item.location && <span><MapPin size={14} aria-hidden="true" /> {item.location}</span>}
      </p>
      {statusLine && <p className={`calendar-agenda-status${open ? " is-open" : ""}`}>{statusLine}</p>}
      {item.clubPortal && (directsClub
        ? open && <Link className="secondary-button open-events-register" href={clubRegistrationEntryPath(decodeURIComponent(item.href!.replace(/^\/events\//, "")))}>Register your club <ChevronRight size={14} aria-hidden="true" /></Link>
        : <p className="open-events-note">Clubs register through their director</p>)}
    </li>
  );
}

/** Events people can register for now or soon (#1217): exactly what the public calendar shows, narrowed by status. */
export default async function OpenForRegistrationPage({ searchParams }: { searchParams: Promise<{ for?: string | string[] }> }) {
  const filter = parseOpenRegistrationFilter((await searchParams).for);
  const today = conferenceToday();
  const [calendarItems, directsClub, featuredRows] = await Promise.all([
    listPublicCalendarItems(today, addDays(today, openRegistrationWindowDays)),
    visitorRegistersClubs(),
    listFeaturedEventRows(today),
  ]);
  // Featured events (#1218) are pinned to the top of this list, each keeping its own card.
  const { items, pinned } = pinFeatured(selectOpenRegistrationItems(calendarItems, filter), featuredRows);

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
          <h1>Open for registration</h1>
        </div>
      </section>

      <div className="calendar-layout">
        <nav aria-label="Who the events are for" className="open-events-filter">
          {openRegistrationFilters.map((value) => (
            <Link aria-current={filter === value ? "page" : undefined} href={openRegistrationHref(value)} key={value}>{filterLabels[value]}</Link>
          ))}
        </nav>

        <section aria-labelledby="open-events-heading" className="calendar-agenda">
          <h2 className="sr-only" id="open-events-heading">Events open for registration</h2>
          {items.length === 0 ? (
            <div className="calendar-empty">
              <p>{emptyWording[filter]}</p>
              <p><Link className="secondary-button open-events-calendar-link" href="/calendar">See the calendar</Link></p>
            </div>
          ) : (
            <ul className="calendar-agenda-list open-events-list">
              {items.map((item) => <EventCard directsClub={directsClub} featured={pinned.has(item)} item={item} key={item.key} />)}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
