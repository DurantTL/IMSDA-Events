import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarDays, ClipboardCheck, ClipboardList, ClipboardPen, Tent } from "lucide-react";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getCurrentSession } from "@/modules/access/current-session";
import { hasClubsAdministration, resolveAdminRoles } from "@/modules/access/admin-roles";
import { getRequiredFormsStatus } from "@/modules/club-forms/required";
import { countWaitingNewClubApplications, listNewClubApplications } from "@/modules/club-applications/repository";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";
import { parseClubQuery } from "@/modules/club-reports/area-summary-domain";
import { getAreaClubsSummary, listAreaClubEvents } from "@/modules/club-reports/area-summary-repository";
import {
  EVENT_TOTAL_NOTE,
  NEW_CLUBS_NOTE,
  buildClubsAdminHome,
  clubYearOptions,
  clubsAdminHrefs,
} from "@/modules/club-reports/clubs-admin-home-model";
import { ClubApplicationApprove, NewClubsRegion } from "@/components/club-application-approve";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { ClubDirectoryCards } from "@/components/club-directory";
import { clubSummaryHref } from "@/modules/club-reports/club-directory-domain";
import styles from "./admin-clubs.module.css";

export const metadata: Metadata = { title: "Club administration" };
export const dynamic = "force-dynamic";

/**
 * The Clubs Administrator dashboard (#1226): what is waiting across every club, then the clubs themselves. It reads
 * through the same repositories as the pages it links to, so each count matches the linked page for the same club year.
 * Approving an application posts to the applications page's own decision route; nothing else here changes a record.
 */
export default async function ClubsAdminPage({ searchParams }: { searchParams: Promise<{ year?: string; q?: string | string[] }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const params = await searchParams;
  const now = new Date();
  const clubYear = resolveAreaClubYear(params.year, now);
  const query = parseClubQuery(params.q);
  const viewer = user.globalRole === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN" : "CLUBS_ADMIN";

  const [clubs, events, applications, waitingCount, roles, requiredForms] = await Promise.all([
    getAreaClubsSummary(clubYear, now, { backgroundChecks: false }),
    listAreaClubEvents(clubYear),
    listNewClubApplications(viewer),
    countWaitingNewClubApplications(viewer),
    resolveAdminRoles(user),
    getRequiredFormsStatus(clubYear),
  ]);
  const home = buildClubsAdminHome({ clubYear, now, clubs, events, applications, waitingCount, requiredForms, query });
  const { counts, nextEvent, registeredClubs } = home;
  const href = clubsAdminHrefs(clubYear);
  const canOpenEvent = nextEvent !== null && (user.globalRole === "SYSTEM_ADMIN" || roles.eventAdminEventIds.includes(nextEvent.id));
  const eventParam = nextEvent ? encodeURIComponent(nextEvent.id) : "";

  return (
    <section className={`page-stack ${styles.workspace}`}>
      <AdminSectionHeaderFor path="/admin/clubs" section="clubs" clubYear={clubYear} waitingApplications={counts.waitingApplications} />

      <section className={styles.hero} aria-labelledby="clubs-admin-heading">
        <p className="eyebrow">All clubs and applications</p>
        <h2 id="clubs-admin-heading">Club administration</h2>
        <p>What is waiting for someone across every club, then the clubs themselves.</p>
        <p className={styles.identity} data-testid="signed-in-identity">Signed in as <strong>{user.displayName}</strong> ({user.email})</p>
      </section>

      <form className={styles.yearForm} method="get" action="/admin/clubs">
        <label>
          Club year
          <select name="year" defaultValue={clubYear}>
            {clubYearOptions(clubYear, now).map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <button className="secondary-button" type="submit">Show</button>
      </form>

      <section aria-labelledby="clubs-admin-summary-heading">
        <h2 id="clubs-admin-summary-heading" className="sr-only">Summary</h2>
        <div className={styles.cards} data-testid="clubs-admin-cards">
          <article data-card="active-clubs">
            <span className={styles.cardIcon}><Tent aria-hidden="true" size={20} /></span>
            <strong>{counts.activeClubs}</strong>
            <p>Active clubs</p>
            <small>Every active club today; records below are for club year {clubYear}</small>
            <small><Link className={styles.cardLink} href={href.summary}>Go to all clubs</Link></small>
          </article>
          <article data-card="new-applications">
            <span className={styles.cardIcon}><ClipboardPen aria-hidden="true" size={20} /></span>
            <strong>{counts.waitingApplications}</strong>
            <p>New club applications waiting</p>
            <small>Every pending application, any year</small>
            <small><Link className={styles.cardLink} href={href.applications}>Open club applications</Link></small>
          </article>
          <article data-card="monthly-records">
            <span className={styles.cardIcon}><ClipboardCheck aria-hidden="true" size={20} /></span>
            <strong>{counts.monthlyRecordsToReview}</strong>
            <p>Monthly records to review</p>
            <small>For {home.reportMonthLabel}: submitted and not marked reviewed yet</small>
            <small><Link className={styles.cardLink} href={href.recordsToReview(home.reportMonth)}>Review monthly records</Link></small>
          </article>
          <article data-card="forms-missing">
            <span className={styles.cardIcon}><ClipboardList aria-hidden="true" size={20} /></span>
            <strong>{counts.clubsWithFormsMissing}</strong>
            <p>Clubs with forms missing</p>
            <small>Clubs missing a required form for club year {clubYear}</small>
            <small><Link className={styles.cardLink} href={href.formsMissing}>See what each is missing</Link></small>
          </article>
          <article data-card="next-event">
            <span className={styles.cardIcon}><CalendarDays aria-hidden="true" size={20} /></span>
            <strong>{nextEvent ? `${nextEvent.registeredClubs} of ${nextEvent.totalClubs}` : "None"}</strong>
            <p>Registered for next event</p>
            <small>{nextEvent ? `${nextEvent.name}, ${nextEvent.dateLabel}` : "No upcoming club events this club year"}</small>
            <small><Link className={styles.cardLink} href={href.clubEvents}>Go to club events</Link></small>
          </article>
        </div>

        <p className={styles.summaryLine} data-testid="clubs-admin-summary">
          <strong>{home.rosterMembers}</strong> roster members across active clubs
          {nextEvent && <> · <strong>{nextEvent.people}</strong> people registered for {nextEvent.name}</>}
        </p>
      </section>

      <NewClubsRegion headingId="new-clubs-heading">
      <section className={`panel ${styles.panel}`} id="new-clubs" aria-labelledby="new-clubs-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Waiting for a decision</p>
            <h2 id="new-clubs-heading" tabIndex={-1}>New clubs</h2>
            <p>{NEW_CLUBS_NOTE}</p>
          </div>
        </div>
        {home.newClubs.length === 0 ? (
          <div className={styles.empty} data-testid="clubs-admin-no-applications">
            <ClipboardPen aria-hidden="true" size={24} />
            <strong>No applications are waiting</strong>
          </div>
        ) : (
          <ul className={styles.applicationList}>
            {home.newClubs.map((application) => (
              <li className={styles.application} key={application.id} data-application-id={application.id}>
                <h3 translate="no">{application.clubName}</h3>
                <p>
                  <span translate="no">{application.churchName}</span> · Submitted {application.submittedLabel}
                  {application.boardMembersLabel && <> · {application.boardMembersLabel}</>}
                </p>
                <div className={styles.applicationActions}>
                  <Link href={application.reviewHref}>Review<span className="sr-only"> {application.clubName}</span> <ArrowRight aria-hidden="true" size={14} /></Link>
                  {application.reviewReasons.length > 0 ? (
                    <p>Review first: {application.reviewReasons.join("; ")}.</p>
                  ) : (
                    <ClubApplicationApprove applicationId={application.id} clubName={application.clubName} directorEmail={application.directorEmail} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {home.moreNewClubs && <Link className={styles.seeAll} href={href.applications}>See all {counts.waitingApplications} waiting</Link>}
      </section>
      </NewClubsRegion>

      <section className={`panel ${styles.panel}`} id="registered-clubs" aria-labelledby="registered-clubs-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Club year {clubYear}</p>
            <h2 id="registered-clubs-heading">Registered clubs</h2>
            <p>{home.reportMonthLabel} records. Clubs with records not submitted or awaiting review appear first.</p>
          </div>
        </div>
        <form className={styles.searchForm} method="get" action="/admin/clubs">
          <input type="hidden" name="year" value={clubYear} />
          <label>
            Search by club or church name
            <input type="search" name="q" defaultValue={query} maxLength={80} autoComplete="off" />
          </label>
          <button className="secondary-button" type="submit">Search</button>
        </form>
        {registeredClubs.rows.length === 0 ? (
          <p className="report-empty">{query ? `No clubs match "${query}".` : "No active clubs."}</p>
        ) : (
          <ClubDirectoryCards clubs={registeredClubs.rows} clubYear={clubYear} monthLabel={home.reportMonthLabel} />
        )}
        <Link className={`secondary-button ${styles.linkButton}`} href={clubSummaryHref({ clubYear, query })} prefetch={false}>
          View all {query ? `${registeredClubs.matchCount} matching` : registeredClubs.total} clubs
        </Link>
      </section>

      <section className={`panel ${styles.panel}`} id="club-events" aria-labelledby="club-events-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Next club event</p>
            <h2 id="club-events-heading">Club events</h2>
            <p>{EVENT_TOTAL_NOTE}</p>
          </div>
        </div>
        {nextEvent ? (
          <>
            <p className={styles.eventLine}>
              <strong translate="no">{nextEvent.name}</strong>, {nextEvent.dateLabel}
              <br />
              {nextEvent.registeredClubs} of {nextEvent.totalClubs} clubs registered · {nextEvent.people} people
            </p>
            {canOpenEvent ? (
              <div className={styles.eventLinks}>
                <Link className={`primary-button ${styles.linkButton}`} href={`/overview?event=${eventParam}`}>Manage event</Link>
                <Link className={`secondary-button ${styles.linkButton}`} href={`/more/kitchen-report?event=${eventParam}`}>Kitchen report</Link>
              </div>
            ) : (
              <p className={styles.rule}>Ask the event&apos;s administrator for the event workspace.</p>
            )}
          </>
        ) : (
          <p className={styles.rule}>No upcoming club events this club year.</p>
        )}
        <Link className={styles.seeAll} href={href.clubEvents}>See every club event</Link>
      </section>

      <section className={`panel ${styles.panel}`} id="quick-actions" aria-labelledby="quick-actions-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Shortcuts</p>
            <h2 id="quick-actions-heading">Quick actions</h2>
          </div>
        </div>
        <ul className={styles.quickActions}>
          <li><Link href={href.points}>Club points</Link></li>
          <li><Link href={href.reports}>Review monthly records</Link></li>
          <li><Link href={href.forms}>Manage forms</Link></li>
          <li><Link href={href.registeredClubs}>View a club roster</Link></li>
        </ul>
      </section>
    </section>
  );
}
