import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { HomepageMinistryIconView } from "@/components/homepage-ministry-icon";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { PublicMetricsBeacon } from "@/components/public-metrics-beacon";
import { HubLink, SiteNoticesView } from "@/components/site-notices-view";
import { eventSlugFromHref, eventTransitionNames } from "@/modules/events/view-transition";
import { EventPhotoCard, eventCardImage } from "@/components/event-photo-card";
import { StartAClubCallout } from "@/components/start-a-club-callout";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { addDays } from "@/modules/calendar/domain";
import { helpContactLinks, ministryTiles, nextClosingSoon, nextMonthsList, seasonRibbon, seasonWindow } from "@/modules/calendar/home-season";
import { conferenceToday, listPublicCalendarItems } from "@/modules/calendar/repository";
import { homeFeaturedLimit, featuredItemsFor } from "@/modules/events/featured-domain";
import { listCuratedFeaturedRows, listEventCardImages, listFeaturedEventRows } from "@/modules/events/featured";
import { activeAnnouncements, activeNotices, linkText, orderedSections, splitVerse, type HubContent, type SectionKey } from "@/modules/site-content/hub-content-domain";
import { listHomepageMinistries } from "@/modules/system-admin/homepage-ministries";
import { getPublicHelpContact } from "@/modules/system-admin/platform-settings";
import styles from "@/components/public-home-page.module.css";

const fullCalendarHref = "/calendar?view=list";
const fullYearHref = "/calendar?view=year";

/**
 * The public front door (#373, #1251, #111). Members, club leaders, and visitors start here. The header offers Sign in
 * (#1009). The real homepage passes the published content and the staff preview passes the draft, so both draw through
 * this one component. Top to bottom: notices, the season band, the sections in the order staff arranged (by default
 * featured events (#1218), announcements, the six-month ribbon on wide screens and "Find your place"), the next three
 * months (phones), then the account links and the footer. Every date comes from the calendar and events. With nothing
 * curated the content is `defaultHubContent()` and the page is what it was before staff could edit it.
 */
export async function PublicHomePage({ content, preview = false }: { content: HubContent; preview?: boolean }) {
  // The staff preview sits inside the workspace's own <main>, so it draws a <div> there (one main landmark per page).
  const Wrapper = preview ? "div" : "main";
  const now = new Date();
  const today = conferenceToday(now);
  const [items, attendee, curatedRows, ministries, help] = await Promise.all([
    listPublicCalendarItems(today, addDays(today, 365)),
    getCurrentAttendee(),
    listCuratedFeaturedRows(content.featuredEventIds, today),
    listHomepageMinistries(),
    getPublicHelpContact(),
  ]);
  // Featured events lead the page as larger cards (#1218). Staff's own choice (#111) wins while any of it still qualifies.
  let featured = featuredItemsFor(items, curatedRows).slice(0, homeFeaturedLimit);
  // When none of the chosen events has a card on the public calendar, the homepage uses the events flagged featured instead.
  if (featured.length === 0) featured = featuredItemsFor(items, await listFeaturedEventRows(today)).slice(0, homeFeaturedLimit);
  const cardImages = await listEventCardImages(featured.flatMap((item) => {
    const slug = eventSlugFromHref(item.href);
    return slug ? [slug] : [];
  }));
  const featuredNames = eventTransitionNames(featured, new Set<string>());
  const signedInName = attendee.account?.displayName || attendee.account?.verifiedEmail;
  const closing = nextClosingSoon(items, now);
  const ribbon = seasonRibbon(items, seasonWindow(today));
  const months = nextMonthsList(items, today);
  const tiles = ministryTiles(ministries, items, today, now);
  const helpLinks = helpContactLinks(help);
  const sections = orderedSections(content);
  const announcements = activeAnnouncements(content, today);
  const verse = content.footer.verse ? splitVerse(content.footer.verse) : null;
  const closingSection = sections.find((section) => section.key === "closing-soon")!;
  const seasonVisible = sections.some((section) => section.key === "season-ribbon" && section.visible);

  const renderers: Record<Exclude<SectionKey, "closing-soon">, (heading: string) => React.ReactNode> = {
    featured: (heading) => featured.length > 0 && (
      <section aria-labelledby="home-featured-heading" className="event-featured" key="featured">
        <h2 id="home-featured-heading">{heading}</h2>
        <ul aria-labelledby="home-featured-heading" className="event-featured-list">
          {featured.map((item) => (
            <EventPhotoCard image={eventCardImage(item, cardImages)} item={item} key={item.key} transitionName={featuredNames.get(item.key)} variant="featured" />
          ))}
        </ul>
      </section>
    ),
    announcements: (heading) => announcements.length > 0 && (
      <section aria-labelledby="home-announcements-heading" className={styles.homeAnnouncements} key="announcements">
        <h2 id="home-announcements-heading">{heading}</h2>
        <ul className={styles.homeAnnouncementsList}>
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <h3>{announcement.title}</h3>
              <p>{announcement.body}</p>
              {announcement.linkHref && <p><HubLink className={styles.homeAnnouncementLink} href={announcement.linkHref}>{linkText(announcement)}<span className="sr-only">{` about ${announcement.title}`}</span></HubLink></p>}
            </li>
          ))}
        </ul>
      </section>
    ),
    "season-ribbon": (heading) => (
      <section aria-labelledby="home-season-heading" className="home-season home-season-ribbon" key="season-ribbon">
        <div className="home-season-head">
          <h2 id="home-season-heading">{heading}</h2>
          <Link className="event-photo-see-all" href={fullYearHref}>See the full year <ChevronRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="season-ribbon">
          <div aria-hidden="true" className="season-months-row">
            <span className="season-lane-spacer" />
            <span className="season-months-track">
              {ribbon.marks.filter((mark) => mark.showLabel).map((mark) => <span className="season-month-label" key={mark.label} style={{ left: `${mark.leftPct}%` }}>{mark.label}</span>)}
            </span>
          </div>
          {ribbon.lanes.map((lane) => (
            <div className="season-lane" key={lane.lane}>
              <h3 className="season-lane-label">{lane.label}</h3>
              <ul aria-label={`${lane.label}, next six months`} className={`season-lane-track season-lane-${lane.lane}`} style={{ height: `${lane.rows * 48 + 8}px` }}>
                {ribbon.marks.filter((mark) => mark.leftPct > 0).map((mark) => <li aria-hidden="true" className="season-gridline" key={mark.label} style={{ left: `${mark.leftPct}%` }} />)}
                {lane.entries.map((entry) => {
                  const title = entry.item.eventTitle ?? entry.item.title;
                  const position = entry.anchor === "left" ? { left: `${entry.edgePct}%` } : { right: `${entry.edgePct}%` };
                  const body = (
                    <>
                      <span aria-hidden="true" className={`season-mark season-mark-${entry.mark}`} style={entry.mark === "bar" ? { width: `${entry.markPct}%` } : undefined} />
                      <span className="season-item-label"><strong>{title}</strong> <small>{entry.dateLabel}</small></span>
                    </>
                  );
                  return (
                    <li className={`season-item season-item-${entry.anchor}`} key={entry.item.key} style={{ ...position, width: `${entry.extentPct}%`, top: `${entry.row * 48 + 4}px` }}>
                      {entry.item.href
                        ? <Link className="season-item-body" href={entry.item.href} title={entry.accessibleLabel}>{body}</Link>
                        : <span className="season-item-body" title={entry.accessibleLabel}>{body}</span>}
                    </li>
                  );
                })}
                {lane.entries.length === 0 && <li className="season-lane-empty">Nothing in this lane.</li>}
              </ul>
            </div>
          ))}
        </div>
        <p className="home-more">
          <Link className="home-events-link" href="/events">See all events open for registration</Link>
        </p>
      </section>
    ),
    "find-your-place": (heading) => (
      <section aria-labelledby="home-places-heading" className="home-places" key="find-your-place">
        <h2 id="home-places-heading">{heading}</h2>
        <ul className="home-places-list">
          {tiles.map((tile) => (
            <li key={tile.position}>
              <Link className="home-place" href={tile.href}>
                <span className="home-place-icon"><HomepageMinistryIconView icon={tile.icon} /></span>
                <span className="home-place-text">
                  <strong>{tile.name}</strong>
                  {tile.description && <span className="home-place-desc">{tile.description}</span>}
                  {tile.next && <span className="home-place-next">{`Next: ${tile.next.title}, ${tile.next.dateLabel}`}</span>}
                  {tile.closing && <span className="home-place-flag">{tile.closing.line}</span>}
                </span>
                <ChevronRight size={20} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    ),
  };

  return (
    <Wrapper className="public-registration-page public-calendar-page public-home-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <Link className="public-registration-brand public-event-brand-link" href="/">
            <BrandMark />
            <span><strong>IMSDA</strong><small>Events</small></span>
          </Link>
          <div className="public-header-links"><PublicHeaderSessionLinks navLinks={content.navLinks} /></div>
        </div>
      </header>

      {!preview && <PublicMetricsBeacon />}
      <SiteNoticesView notices={activeNotices(content, today)} />

      <section className="public-registration-hero calendar-hero public-home-banner season-band">
        <div className="season-band-text">
          <p className="public-registration-eyebrow">Iowa-Missouri Conference</p>
          <h1>The season ahead</h1>
          <p className="season-band-line">Camps, clubs and conference dates for the next six months.</p>
        </div>
        {closing && closingSection.visible && (
          <aside aria-labelledby="season-closing-heading" className="season-closing">
            <h2 id="season-closing-heading">{closingSection.heading}</h2>
            <p className="season-closing-title">{closing.item.eventTitle ?? closing.item.title}</p>
            <p className="season-closing-line">{closing.line}</p>
            {closing.item.href && (
              <Link className="season-closing-register" href={closing.item.href}>
                Register<span className="sr-only">{` for ${closing.item.eventTitle ?? closing.item.title}`}</span>
              </Link>
            )}
          </aside>
        )}
      </section>

      <div className="calendar-layout">
        {sections.map((section) => (section.key === "closing-soon" || !section.visible ? null : renderers[section.key](section.heading)))}

        {seasonVisible && (
          <section aria-labelledby="home-months-heading" className="home-season home-season-months">
            <h2 id="home-months-heading">Next three months</h2>
            <ol className="season-month-list">
              {months.map((month) => (
                <li key={month.key}>
                  <h3>{month.label}</h3>
                  {month.entries.length === 0 ? (
                    <p className="calendar-empty">Nothing scheduled yet.</p>
                  ) : (
                    <ul>
                      {month.entries.map(({ item, dateLabel, isClosure }) => (
                        <li key={item.key}>
                          <span className="season-month-date">{dateLabel}</span>
                          {item.href
                            ? <Link className="season-month-link" href={item.href}>{item.eventTitle ?? item.title}</Link>
                            : <span className="season-month-name">{item.eventTitle ?? item.title}</span>}
                          {isClosure && <span className="season-month-tag">Office closed</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            <p className="home-more">
              <Link className="primary-button home-calendar-button" href={fullCalendarHref}>
                <CalendarDays size={18} aria-hidden="true" /> See the full calendar
              </Link>
            </p>
            <p className="home-more">
              <Link className="home-events-link" href="/events">See all events open for registration</Link>
            </p>
          </section>
        )}

        <nav aria-label="Get started" className="home-links">
          <ul>
            <li>
              <Link href="/account">
                <span>
                  <strong>My registrations</strong>
                  {signedInName && <small>{`Signed in as ${signedInName}`}</small>}
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

        <footer className="home-footer">
          {verse && <p className="home-footer-verse">{verse.text}{verse.cite && <> <cite>{verse.cite}</cite></>}</p>}
          {content.footer.contactLines.map((line, index) => <p className={styles.homeFooterContact} key={`${index}-${line}`}>{line}</p>)}
          {content.footer.links.length > 0 && (
            <nav aria-label="Footer links" className={styles.homeFooterLinks}>
              <ul>
                {content.footer.links.map((link, index) => <li key={`${link.href}-${index}`}><HubLink href={link.href}>{link.label}</HubLink></li>)}
              </ul>
            </nav>
          )}
          {helpLinks && (
            <p className="home-footer-help">
              Need help?{" "}
              {helpLinks.phone && <>Call <a href={helpLinks.phone.href}>{helpLinks.phone.text}</a></>}
              {helpLinks.phone && helpLinks.email && " or "}
              {helpLinks.email && <>{helpLinks.phone ? "email" : "Email"} <a href={helpLinks.email.href}>{helpLinks.email.text}</a></>}
            </p>
          )}
        </footer>
      </div>
    </Wrapper>
  );
}
