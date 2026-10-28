import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronRight, MapPin } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { PublicMetricsBeacon } from "@/components/public-metrics-beacon";
import { SiteNoticesView } from "@/components/site-notices-view";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { addDays, calendarCountLabel, calendarItemStatusLine, formatDateRange, type CalendarItem } from "@/modules/calendar/domain";
import {
  applyEventDirectoryFilters,
  eventDirectoryHref,
  eventDirectoryOptions,
  hasActiveDirectoryFilters,
  parseEventDirectoryFilters,
  type EventDirectorySearchParams,
} from "@/modules/calendar/event-directory";
import {
  openRegistrationFilters,
  openRegistrationWindowDays,
  selectOpenRegistrationItems,
  type OpenRegistrationFilter,
} from "@/modules/calendar/open-registration";
import { conferenceToday, listPublicCalendarItems } from "@/modules/calendar/repository";
import { pinFeatured } from "@/modules/events/featured-domain";
import { listFeaturedEventRows } from "@/modules/events/featured";
import { getPublishedHubContent } from "@/modules/site-content/hub-content";
import { directoryFiltersInUse } from "@/modules/public-metrics/domain";
import { activeNotices, applyCategoryPreferences } from "@/modules/site-content/hub-content-domain";
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
export default async function OpenForRegistrationPage({ searchParams }: { searchParams: Promise<EventDirectorySearchParams> }) {
  const filters = parseEventDirectoryFilters(await searchParams);
  const filter = filters.audience;
  const filtering = hasActiveDirectoryFilters(filters);
  // Only which filters were used is counted, never what was typed or chosen (#111).
  const used = directoryFiltersInUse(filters);
  const today = conferenceToday();
  const windowEnd = addDays(today, openRegistrationWindowDays);
  const [calendarItems, directsClub, featuredRows, hubContent] = await Promise.all([
    listPublicCalendarItems(today, windowEnd),
    visitorRegistersClubs(),
    listFeaturedEventRows(today),
    getPublishedHubContent(),
  ]);
  // Featured events (#1218) are pinned to the top of this list, each keeping its own card.
  // Search and filters (#106) narrow the open list first, so pinning only ever lifts events that matched.
  const openItems = selectOpenRegistrationItems(calendarItems, filter);
  const { categories: allCategories, locations } = eventDirectoryOptions(openItems, filters);
  // Staff can reorder and hide category choices (#111); hiding only removes the choice, the events stay listed.
  const categories = applyCategoryPreferences(allCategories, hubContent.calendarCategories, filters.category);
  const { items, pinned } = pinFeatured(applyEventDirectoryFilters(openItems, filters), featuredRows);
  const clearHref = eventDirectoryHref({ audience: filter });

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

      <PublicMetricsBeacon hits={[
        ...(used.search ? [{ metric: "DIRECTORY_SEARCH" as const }] : []),
        ...used.filters.map((name) => ({ metric: "DIRECTORY_FILTER" as const, dimension: name })),
      ]} />
      <SiteNoticesView notices={activeNotices(hubContent, today)} />

      <section className="public-registration-hero calendar-hero public-home-banner">
        <div>
          <p className="public-registration-eyebrow">Iowa-Missouri Conference</p>
          <h1>Open for registration</h1>
        </div>
      </section>

      <div className="calendar-layout">
        <nav aria-label="Who the events are for" className="open-events-filter">
          {openRegistrationFilters.map((value) => (
            <Link aria-current={filter === value ? "page" : undefined} href={eventDirectoryHref({ ...filters, audience: value })} key={value}>{filterLabels[value]}</Link>
          ))}
        </nav>

        <form action="/events" className="events-directory-form" method="get" role="search" aria-label="Search and filter events">
          {filter !== "all" && <input name="for" type="hidden" value={filter} />}
          <div className="events-directory-field events-directory-search">
            <label htmlFor="events-q">Search events</label>
            <input defaultValue={filters.q} id="events-q" maxLength={100} name="q" type="search" />
          </div>
          <div className="events-directory-field">
            <label htmlFor="events-from">From</label>
            <input defaultValue={filters.from} id="events-from" max={windowEnd} min={today} name="from" type="date" />
          </div>
          <div className="events-directory-field">
            <label htmlFor="events-to">To</label>
            <input defaultValue={filters.to} id="events-to" max={windowEnd} min={today} name="to" type="date" />
          </div>
          <div className="events-directory-field">
            <label htmlFor="events-category">Category</label>
            <select defaultValue={filters.category} id="events-category" name="category">
              <option value="">Any</option>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="events-directory-field">
            <label htmlFor="events-location">Location</label>
            <select defaultValue={filters.location} id="events-location" name="location">
              <option value="">Any</option>
              {locations.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="events-directory-actions">
            <button className="primary-button" type="submit">Show events</button>
            {filtering && <Link className="secondary-button" href={clearHref}>Clear filters</Link>}
          </div>
        </form>
        <p className="events-directory-count" role="status">{calendarCountLabel(items.length)}</p>

        <section aria-labelledby="open-events-heading" className="calendar-agenda">
          <h2 className="sr-only" id="open-events-heading">Events open for registration</h2>
          {items.length === 0 ? (
            <div className="calendar-empty">
              <p>{filtering ? "No events match these filters." : emptyWording[filter]}</p>
              {filtering && <p><Link className="secondary-button open-events-calendar-link" href={clearHref}>Clear filters</Link></p>}
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
