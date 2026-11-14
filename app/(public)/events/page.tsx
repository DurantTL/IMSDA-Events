import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronRight, MapPin } from "lucide-react";
import { EventsSearchField } from "./events-search-field";
import { SearchAsYouTypeForm } from "@/components/search-as-you-type";
import { BrandLink } from "@/components/brand-link";
import { PublicExploreNav } from "@/components/public-explore-nav";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { PublicMetricsBeacon } from "@/components/public-metrics-beacon";
import { HubLink, SiteNoticesView } from "@/components/site-notices-view";
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
import { directoryFiltersInUse, normalizeSearchTerm } from "@/modules/public-metrics/domain";
import { activeNotices, applyCategoryPreferences, splitVerse } from "@/modules/site-content/hub-content-domain";
import { clubRegistrationEntryPath } from "@/modules/club-registrations/entry-path";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import homeStyles from "@/components/public-home-page.module.css";
import styles from "./events-directory.module.css";

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
  // A search that showed no event card at all (#1560): the cleaned term is counted, never the raw text.
  const noResultTerm = filters.q && items.length === 0 ? normalizeSearchTerm(filters.q) : null;
  const noResultHits = noResultTerm ? [{ metric: "SEARCH_NO_RESULTS" as const, dimension: noResultTerm }] : [];
  const clearHref = eventDirectoryHref({ audience: filter });
  const verse = hubContent.footer.verse ? splitVerse(hubContent.footer.verse) : null;

  return (
    <main className={`public-registration-page public-calendar-page public-home-page ${homeStyles.page} ${styles.directory}`}>
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand public-event-brand-link" destination="home" wordmark />
          <PublicExploreNav current="events" />
          <div className="public-header-links"><PublicHeaderSessionLinks navLinks={[]} /></div>
        </div>
      </header>

      <PublicMetricsBeacon hits={[
        ...(used.search ? [{ metric: "DIRECTORY_SEARCH" as const }] : []),
        ...noResultHits,
        ...used.filters.map((name) => ({ metric: "DIRECTORY_FILTER" as const, dimension: name })),
      ]} />
      <SiteNoticesView notices={activeNotices(hubContent, today)} />

      <section className="public-registration-hero calendar-hero public-home-banner">
        <div>
          <p className="public-registration-eyebrow">Iowa–Missouri Conference</p>
          <h1>Open for registration</h1>
          <p className={styles.heroDescription}>Find a gathering for your family, your club, or your community.</p>
        </div>
      </section>

      <div className="calendar-layout">
        <div className={styles.discovery}>
          <nav aria-label="Who the events are for" className="open-events-filter">
            {openRegistrationFilters.map((value) => (
              <Link aria-current={filter === value ? "page" : undefined} href={eventDirectoryHref({ ...filters, audience: value })} key={value}>{filterLabels[value]}</Link>
            ))}
          </nav>

          <SearchAsYouTypeForm action="/events" className={styles.eventsDirectoryForm} role="search" aria-label="Search and filter events">
            {filter !== "all" && <input name="for" type="hidden" value={filter} />}
            <div className={`${styles.eventsDirectoryField} ${styles.eventsDirectorySearch}`}>
              <label htmlFor="events-q">Search events</label>
              <EventsSearchField defaultValue={filters.q ?? ""} />
            </div>
            <details className={styles.eventsDirectoryMore} open={Boolean(filters.from || filters.to || filters.category || filters.location)}>
              <summary>More filters</summary>
              <div className={styles.eventsDirectoryFields}>
                <div className={styles.eventsDirectoryField}>
                  <label htmlFor="events-from">From</label>
                  <input defaultValue={filters.from} id="events-from" max={windowEnd} min={today} name="from" type="date" />
                </div>
                <div className={styles.eventsDirectoryField}>
                  <label htmlFor="events-to">To</label>
                  <input defaultValue={filters.to} id="events-to" max={windowEnd} min={today} name="to" type="date" />
                </div>
                <div className={styles.eventsDirectoryField}>
                  <label htmlFor="events-category">Category</label>
                  <select defaultValue={filters.category} id="events-category" name="category">
                    <option value="">Any</option>
                    {categories.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
                <div className={styles.eventsDirectoryField}>
                  <label htmlFor="events-location">Location</label>
                  <select defaultValue={filters.location} id="events-location" name="location">
                    <option value="">Any</option>
                    {locations.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
              </div>
            </details>
            <div className={styles.eventsDirectoryActions}>
              <button className="primary-button" type="submit">Show events</button>
              {filtering && <Link className="secondary-button" href={clearHref}>Clear filters</Link>}
            </div>
          </SearchAsYouTypeForm>
        </div>

        <section aria-labelledby="open-events-heading" className="calendar-agenda">
          <div className={styles.resultsHeading}><h2 id="open-events-heading">Events open for registration</h2><p className={styles.eventsDirectoryCount} role="status">{calendarCountLabel(items.length)}</p></div>
          {items.length === 0 ? (
            <div className="calendar-empty">
              <p>{filtering ? "No events match these filters." : emptyWording[filter]}</p>
              {filtering && <p><Link className="secondary-button open-events-calendar-link" href={clearHref}>Clear filters</Link></p>}
              <p><a className="secondary-button open-events-calendar-link" href="/calendar">See the calendar</a></p>
            </div>
          ) : (
            <ul className="calendar-agenda-list open-events-list">
              {items.map((item) => <EventCard directsClub={directsClub} featured={pinned.has(item)} item={item} key={item.key} />)}
            </ul>
          )}
        </section>
        <footer className="home-footer">
          {verse && <p className="home-footer-verse">{verse.text}{verse.cite && <> <cite>{verse.cite}</cite></>}</p>}
          {hubContent.footer.contactLines.map((line, index) => <p className={homeStyles.homeFooterContact} key={`${index}-${line}`}>{line}</p>)}
          {hubContent.footer.links.length > 0 && <nav aria-label="Footer links" className={homeStyles.homeFooterLinks}><ul>
            {hubContent.footer.links.map((link, index) => <li key={`${link.href}-${index}`}><HubLink href={link.href}>{link.label}</HubLink></li>)}
          </ul></nav>}
        </footer>
      </div>
    </main>
  );
}
