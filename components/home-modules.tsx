import { ArrowRight } from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import styles from "@/components/home-modules.module.css";
import type { EventsFillingUpView, MonthlyRecordsView, SeasonNumbersView } from "@/modules/system-admin/home-modules-model";
import type { ClubApplicationsView, LiveCheckInView, MoneyThisSeasonView } from "@/modules/system-admin/home-extra-modules-model";

/** The shared "could not read" message: never shown as zero or as nothing waiting. */
function Unavailable({ what }: { what: string }) {
  return (
    <p className={styles.message} data-tone="unavailable" data-testid="home-module-unavailable">
      <span className={`status-chip neutral ${styles.chip}`}>Unavailable</span> {what} could not be read just now. Try again in a moment.
    </p>
  );
}

function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className={styles.link} href={href}>
      {label}
      <ArrowRight aria-hidden="true" size={14} />
    </Link>
  );
}

/** Events filling up (#1705): spots taken against capacity, waitlist and days to go. No money. */
export function EventsFillingUpModule({ view }: { view: EventsFillingUpView | null }) {
  if (!view) return <Unavailable what="Your events" />;
  return (
    <div className={styles.module} data-testid="home-events-filling-up">
      {view.rows.length === 0 ? (
        <p className={styles.message} data-testid="home-events-filling-up-empty"><strong>No upcoming events.</strong> Events that have ended or been archived are not listed here.</p>
      ) : (
        <ul className={styles.list}>
          {view.rows.map((row) => (
            <li key={row.id} data-event-id={row.id}>
              <Link className={styles.eventRow} href={row.href}>
                <span className={styles.rowTop}>
                  <span className={styles.rowTitle} translate="no">{row.name}</span>
                  <span className={styles.rowMeta}>{row.daysText}</span>
                </span>
                <span className={styles.rowText}>{row.takenText}</span>
                {row.percentTaken !== null ? (
                  <span className={styles.bar} aria-hidden="true"><span className={styles.barFill} style={{ width: `${row.percentTaken}%` }} /></span>
                ) : null}
                {row.waitlist !== null ? <span className={styles.rowText}>Waitlist: {row.waitlist}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <FooterLink {...view.footerLink} />
    </div>
  );
}

const SPARK_W = 120;
const SPARK_H = 32;

/** A small line of daily counts; decorative, the text beside it carries the numbers. */
function Sparkline({ days }: { days: readonly number[] }) {
  const max = Math.max(1, ...days);
  const step = SPARK_W / Math.max(1, days.length - 1);
  const points = days.map((count, at) => `${(at * step).toFixed(1)},${(SPARK_H - 2 - (count / max) * (SPARK_H - 4)).toFixed(1)}`).join(" ");
  return (
    <svg className={styles.spark} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden="true" focusable="false" data-testid="home-season-sparkline">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Season numbers (#1705): this club year's registrations, people and clubs, with a 30-day trend. */
export function SeasonNumbersModule({ view }: { view: SeasonNumbersView | null }) {
  if (!view) return <Unavailable what="The season numbers" />;
  return (
    <div className={styles.module} data-testid="home-season-numbers">
      <p className={styles.rowText}>Club year {view.clubYear}</p>
      <ul className={styles.tiles}>
        {view.tiles.map((tile) => (
          <li key={tile.key} className={styles.tile} data-tile={tile.key}>
            <Link className={styles.tileLink} href={tile.href}>
              <span className={styles.tileValue}>
                {tile.value === null ? <span className={`status-chip neutral ${styles.chip}`}>Unavailable</span> : tile.value.toLocaleString("en-US")}
              </span>
              <span className={styles.tileLabel}>{tile.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      {view.trend ? (
        <div className={styles.trend} data-testid="home-season-trend">
          <Sparkline days={view.trend.days} />
          <p className={styles.rowText}>{view.trend.text}</p>
        </div>
      ) : null}
      {view.trendUnavailable ? <Unavailable what="The 30-day trend" /> : null}
    </div>
  );
}

/** Monthly Records by area (#1705): one conference-wide row for now; a later issue splits it by area. */
export function MonthlyRecordsModule({ view }: { view: MonthlyRecordsView | null }) {
  if (!view) return <Unavailable what="Monthly Records" />;
  return (
    <div className={styles.module} data-testid="home-monthly-records">
      <p className={styles.rowText}>{view.monthLabel}</p>
      <ul className={styles.list}>
        {view.rows.map((row) => (
          <li key={row.label} className={styles.recordRow}>
            <p className={styles.rowTitle}>{row.label}</p>
            <dl className={styles.counts}>
              <div><dt>Submitted</dt><dd>{row.submitted}</dd></div>
              <div><dt>Started</dt><dd>{row.started}</dd></div>
              <div><dt>Not started</dt><dd>{row.notStarted}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
      <FooterLink href={view.href} label="Review monthly records" />
    </div>
  );
}

/** Club applications (#1893): how many wait for a decision, and the oldest few with how long each has waited. */
export function ClubApplicationsModule({ view }: { view: ClubApplicationsView | null }) {
  if (!view) return <Unavailable what="Club applications" />;
  return (
    <div className={styles.module} data-testid="home-club-applications">
      {view.waitingCount === 0 ? (
        <p className={styles.message} data-testid="home-club-applications-empty"><strong>No applications waiting.</strong> New club applications show here until someone decides them.</p>
      ) : (
        <>
          <p className={styles.rowText}>{view.waitingCount === 1 ? "1 application waiting for a decision" : `${view.waitingCount} applications waiting for a decision`}, oldest first</p>
          <ul className={styles.list}>
            {view.rows.map((row) => (
              <li key={row.id} data-application-id={row.id}>
                <Link className={styles.eventRow} href={row.href}>
                  <span className={styles.rowTop}>
                    <span className={styles.rowTitle} translate="no">{row.clubName}</span>
                    <span className={styles.rowMeta}>{row.waitedText}</span>
                  </span>
                  <span className={styles.rowText}>{row.clubTypeLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <FooterLink href={view.href} label="Review applications" />
    </div>
  );
}

/** Money this season (#1893): collected, still owed and refunds waiting, added up and per event the person can open Payments for. */
export function MoneyThisSeasonModule({ view }: { view: MoneyThisSeasonView | null }) {
  if (!view) return <Unavailable what="The money numbers" />;
  if (view.totals.eventCount === 0) {
    return (
      <div className={styles.module} data-testid="home-money-this-season">
        <p className={styles.message} data-testid="home-money-empty"><strong>No events this season.</strong> Events you can open Payments for show here once they are set up for club year {view.clubYear}.</p>
      </div>
    );
  }
  return (
    <div className={styles.module} data-testid="home-money-this-season">
      <p className={styles.rowText}>Club year {view.clubYear}, {view.totals.eventCount === 1 ? "1 event" : `${view.totals.eventCount} events`}</p>
      <dl className={`${styles.counts} ${styles.moneyCounts}`} data-testid="home-money-totals">
        <div><dt>Collected</dt><dd>{view.totals.collectedText}</dd></div>
        <div><dt>Still owed</dt><dd>{view.totals.owedText}</dd></div>
        <div><dt>Refunds waiting</dt><dd>{view.totals.refundsText}</dd></div>
      </dl>
      <ul className={styles.list}>
        {view.rows.map((row) => (
          <li key={row.id} data-event-id={row.id}>
            <Link className={styles.eventRow} href={row.href}>
              <span className={styles.rowTitle} translate="no">{row.name}</span>
              <span className={styles.rowText}>Collected {row.collectedText} · Still owed {row.owedText} · Refunds waiting {row.refundsText}</span>
            </Link>
          </li>
        ))}
      </ul>
      {view.moreCount > 0 ? <p className={styles.rowText}>{view.moreCount === 1 ? "1 more event is" : `${view.moreCount} more events are`} in the totals above.</p> : null}
      <FooterLink {...view.footerLink} />
    </div>
  );
}

/** Live check-in (#1893): only while an event's check-in is open; people and clubs checked in, and the last arrival. */
export function LiveCheckInModule({ view }: { view: LiveCheckInView | null }) {
  if (!view) return <Unavailable what="Live check-in" />;
  return (
    <div className={styles.module} data-testid="home-live-check-in">
      <ul className={styles.list}>
        {view.rows.map((row) => (
          <li key={row.id} data-event-id={row.id}>
            <Link className={styles.eventRow} href={row.href}>
              <span className={styles.rowTop}>
                <span className={styles.rowTitle} translate="no">{row.name}</span>
                <span className={styles.rowMeta}>{row.lastArrivalText}</span>
              </span>
              <span className={styles.rowText}>{row.peopleText}</span>
              <span className={styles.bar} aria-hidden="true"><span className={styles.barFill} style={{ width: `${row.percentCheckedIn}%` }} /></span>
              {row.clubsText ? <span className={styles.rowText}>{row.clubsText}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
