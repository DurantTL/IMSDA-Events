import Link from "next/link";
import { Award, ArrowRight, CalendarDays, CheckCircle2, CircleAlert, FileText, ShieldCheck, UsersRound } from "lucide-react";
import styles from "./club-year-home-card.module.css";
import { yearLabel } from "@/modules/club-rosters/home-view";
import { formatDueDate, type MonthlyReportProgress } from "@/modules/club-reports/domain";
import type { RosterYearSummary } from "@/modules/club-rosters/domain";
import type { HonorYearSummary } from "@/modules/honors/member-honor-domain";

/**
 * The club-year dashboard (#488): roster, honors, Sterling Volunteers, events,
 * and monthly reports at a glance, each tile linking to where the work is
 * done. Every tile is built from data its caller already loaded — no new
 * queries and no new data entry. Each `href` is the caller's own choice: a
 * director links to the club's own roster/honors/events/reports pages, while
 * a read-only viewer whose page already shows that section inline can point
 * at its anchor on the same page instead.
 */

export type EventsTileSummary = { open: number; registered: number };

/** Sterling Volunteers counts only (#479) — never a name, so this is safe for any caller allowed the roster's counts. */
export type ComplianceTileSummary = { missing: number; notInCompliance: number; expiringSoon: number };

export function ClubYearTiles({
  roster,
  rosterHref,
  honors,
  honorsHref,
  compliance,
  complianceHref,
  events,
  eventsHref,
  reports,
  reportsHref,
  headingLevel = 2,
}: {
  roster: RosterYearSummary;
  rosterHref: string;
  /** Null hides the tile: honors are visible to anyone who can view the roster, but a caller may not have loaded them. */
  honors: HonorYearSummary | null;
  /** Where "Open honors" goes; no link when the viewer has no Honors page (#819). */
  honorsHref?: string;
  /** Null hides the tile: the viewer isn't allowed Sterling Volunteers information at all. */
  compliance: ComplianceTileSummary | null;
  complianceHref: string;
  events: EventsTileSummary;
  eventsHref: string;
  /** Null hides the tile: the viewer's role doesn't submit or see reports. */
  reports: MonthlyReportProgress | null;
  reportsHref: string;
  /** Tile heading level: 2 under the page's h1 (the default), 3 on a page that puts its own h2 above the tiles. */
  headingLevel?: 2 | 3;
}) {
  const Heading = `h${headingLevel}` as const;
  const complianceTotal = compliance ? compliance.missing + compliance.notInCompliance + compliance.expiringSoon : 0;
  return (
    <div className="club-year-tiles">
      <div className="club-year-tile">
        <Heading className="club-year-tile-heading"><UsersRound size={16} aria-hidden="true" /> Roster</Heading>
        <p className="club-year-tile-stat">{roster.active}</p>
        <p className="club-year-tile-detail">{`active this club year · ${roster.staff} staff · ${roster.members} members`}</p>
        {roster.byClass.length > 0 && (
          <ul className="club-year-tile-list">
            {roster.byClass.map((entry) => <li key={entry.classLevel}>{entry.label} {entry.count}</li>)}
          </ul>
        )}
        <Link className="secondary-button club-year-tile-link" href={rosterHref}>Open roster</Link>
      </div>

      {honors && (
        <div className="club-year-tile">
          <Heading className="club-year-tile-heading"><Award size={16} aria-hidden="true" /> Honors</Heading>
          {honors.inProgress === 0 && honors.completedThisYear === 0 ? (
            <p className="club-year-tile-detail">None recorded yet this club year.</p>
          ) : (
            <ul className="club-year-tile-list">
              {honors.inProgress > 0 && <li>{`${honors.inProgress} in progress`}</li>}
              {honors.completedThisYear > 0 && <li>{`${honors.completedThisYear} completed this year`}</li>}
            </ul>
          )}
          {honorsHref && <Link className="secondary-button club-year-tile-link" href={honorsHref}>Open honors</Link>}
        </div>
      )}

      {compliance && (
        <div className="club-year-tile">
          <Heading className="club-year-tile-heading"><ShieldCheck size={16} aria-hidden="true" /> Sterling Volunteers</Heading>
          {complianceTotal === 0 ? (
            <p className="club-year-tile-detail"><CheckCircle2 size={15} aria-hidden="true" /> All current.</p>
          ) : (
            <ul className="club-year-tile-list">
              {compliance.missing > 0 && <li><CircleAlert size={13} aria-hidden="true" /> {compliance.missing} missing</li>}
              {compliance.notInCompliance > 0 && <li><CircleAlert size={13} aria-hidden="true" /> {compliance.notInCompliance} not in compliance</li>}
              {compliance.expiringSoon > 0 && <li><CircleAlert size={13} aria-hidden="true" /> {compliance.expiringSoon} expiring soon</li>}
            </ul>
          )}
          <Link className="secondary-button club-year-tile-link" href={complianceHref}>Review Sterling Volunteers</Link>
        </div>
      )}

      <div className="club-year-tile">
        <Heading className="club-year-tile-heading"><CalendarDays size={16} aria-hidden="true" /> Events</Heading>
        <p className="club-year-tile-stat">{events.open}</p>
        <p className="club-year-tile-detail">
          {events.open === 1 ? "event open to register" : "events open to register"} · {events.registered} registered
        </p>
        <Link className="secondary-button club-year-tile-link" href={eventsHref}>Open events</Link>
      </div>

      {reports && (
        <div className="club-year-tile">
          <Heading className="club-year-tile-heading"><FileText size={16} aria-hidden="true" /> Monthly Records</Heading>
          <p className="club-year-tile-stat">{reports.filed}</p>
          <p className="club-year-tile-detail">
            filed this club year
            {reports.missing > 0 && ` · ${reports.missing} missing`}
            {reports.dueSoon && ` · ${reports.dueSoon.count} due ${formatDueDate(reports.dueSoon.dueDate)}`}
            {reports.missing === 0 && !reports.dueSoon && " · none missing"}
          </p>
          <Link className="secondary-button club-year-tile-link" href={reportsHref}>Open Monthly Records</Link>
        </div>
      )}
    </div>
  );
}

/**
 * The same five facts as `ClubYearTiles`, laid out like the club home's "Your club this year" card (#1555): one card,
 * an eyebrow and bold heading, count tiles (`club-home-counts`) and an "Open ... →" link under each. Used for the
 * Area Coordinator's view of a club. Same data, same links; nothing here adds access.
 */
export function ClubYearHomeCard({
  clubYear,
  roster,
  rosterHref,
  honors,
  honorsHref,
  compliance,
  complianceHref,
  events,
  eventsHref,
  reports,
  reportsHref,
}: {
  clubYear: string;
  roster: RosterYearSummary;
  rosterHref: string;
  honors: HonorYearSummary | null;
  honorsHref?: string;
  compliance: ComplianceTileSummary | null;
  complianceHref: string;
  events: EventsTileSummary;
  eventsHref: string;
  reports: MonthlyReportProgress | null;
  reportsHref: string;
}) {
  const complianceTotal = compliance ? compliance.missing + compliance.notInCompliance + compliance.expiringSoon : 0;
  const open = (href: string, label: string) => (
    <dd className={styles.link}>
      <Link className="secondary-button club-event-action club-home-link" href={href}>{label} <ArrowRight size={14} aria-hidden="true" /></Link>
    </dd>
  );
  return (
    <section aria-labelledby="club-year-home-heading" className="public-manage-card club-home-summary">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">{`Club year ${yearLabel(clubYear)}`}</p>
        <h2 id="club-year-home-heading">This club this year</h2>
      </div>
      <dl className="club-home-counts">
        <div className="club-home-count">
          <dt className={styles.term}><UsersRound size={16} aria-hidden="true" /> Roster</dt>
          <dd className="club-home-count-value">{roster.active}</dd>
          <dd className="club-home-count-definition">{`active this club year · ${roster.staff} staff · ${roster.members} members`}</dd>
          {open(rosterHref, "Open roster")}
        </div>
        {honors && (
          <div className="club-home-count">
            <dt className={styles.term}><Award size={16} aria-hidden="true" /> Honors</dt>
            <dd className="club-home-count-value">{honors.inProgress + honors.completedThisYear}</dd>
            <dd className="club-home-count-definition">
              {honors.inProgress === 0 && honors.completedThisYear === 0
                ? "None recorded yet this club year."
                : [honors.inProgress > 0 ? `${honors.inProgress} in progress` : null, honors.completedThisYear > 0 ? `${honors.completedThisYear} completed this year` : null].filter(Boolean).join(" · ")}
            </dd>
            {honorsHref && open(honorsHref, "Open honors")}
          </div>
        )}
        {compliance && (
          <div className="club-home-count">
            <dt className={styles.term}><ShieldCheck size={16} aria-hidden="true" /> Sterling Volunteers</dt>
            <dd className="club-home-count-value">{complianceTotal === 0 ? "All current" : complianceTotal}</dd>
            <dd className="club-home-count-definition">
              {complianceTotal === 0
                ? "No one is missing, out of compliance or expiring soon."
                : [compliance.missing > 0 ? `${compliance.missing} missing` : null, compliance.notInCompliance > 0 ? `${compliance.notInCompliance} not in compliance` : null, compliance.expiringSoon > 0 ? `${compliance.expiringSoon} expiring soon` : null].filter(Boolean).join(" · ")}
            </dd>
            {open(complianceHref, "Review Sterling Volunteers")}
          </div>
        )}
        <div className="club-home-count">
          <dt className={styles.term}><CalendarDays size={16} aria-hidden="true" /> Events</dt>
          <dd className="club-home-count-value">{events.open}</dd>
          <dd className="club-home-count-definition">{`${events.open === 1 ? "event open to register" : "events open to register"} · ${events.registered} registered`}</dd>
          {open(eventsHref, "Open events")}
        </div>
        {reports && (
          <div className="club-home-count">
            <dt className={styles.term}><FileText size={16} aria-hidden="true" /> Monthly Records</dt>
            <dd className="club-home-count-value">{reports.filed}</dd>
            <dd className="club-home-count-definition">
              {`filed this club year${reports.missing > 0 ? ` · ${reports.missing} missing` : ""}${reports.dueSoon ? ` · ${reports.dueSoon.count} due ${formatDueDate(reports.dueSoon.dueDate)}` : ""}${reports.missing === 0 && !reports.dueSoon ? " · none missing" : ""}`}
            </dd>
            {open(reportsHref, "Open Monthly Records")}
          </div>
        )}
      </dl>
    </section>
  );
}
