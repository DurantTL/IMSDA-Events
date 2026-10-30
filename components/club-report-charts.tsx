import Link from "next/link";
import { useId } from "react";
import {
  pointsChartDescription,
  sortLeaderboard,
  type MonthCell,
  type MonthlyStatusTotals,
} from "@/modules/club-reports/area-summary-domain";
import type { CoordinatorMonthTotals, RecordState } from "@/modules/club-reports/coordinator-overview-domain";
import styles from "./club-report-charts.module.css";

/**
 * Presentational chart pieces for the club report pages (#1312, design #1308). Data in, markup out: nothing here
 * counts or queries. Inline SVG and plain HTML only; every chart is a figure with a name, a text summary and a
 * table alternative, and status is always an icon plus a word.
 */

const number = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many: string) => `${number(count)} ${count === 1 ? one : many}`;
/** An SVG-safe id fragment from `useId` (its punctuation changes between React versions). */
const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "");

/** "2025-09" as "Sep". */
export function shortMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, value! - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

/* ------------------------------------------------------------------ Summary band */

export type SummaryTile = { label: string; value: string | number; detail?: string; href?: string };

/** `compact` (opt-in) tightens the band on phones: two columns, smaller values. */
export function ReportSummaryBand({ tiles, label, compact }: { tiles: readonly SummaryTile[]; label?: string; compact?: boolean }) {
  return (
    <ul aria-label={label} className={compact ? `${styles.band} ${styles.bandCompact}` : styles.band}>
      {tiles.map((tile, index) => {
        const body = (
          <>
            <span className={styles.tileLabel}>{tile.label}</span>
            <strong className={styles.tileValue}>{typeof tile.value === "number" ? number(tile.value) : tile.value}</strong>
            {tile.detail && <span className={styles.tileDetail}>{tile.detail}</span>}
          </>
        );
        return (
          <li className={styles.tile} key={`${index}-${tile.label}`}>
            {tile.href ? <Link className={styles.tileLink} href={tile.href}>{body}</Link> : <div className={styles.tileBody}>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ Records by month */

export type RecordsByMonthChartProps = {
  clubYear: string;
  /** "YYYY-MM" to outline. */
  selectedMonth?: string;
  title?: string;
} & (
  | { variant: "staff"; totals: readonly MonthlyStatusTotals[] }
  | { variant: "coordinator"; totals: readonly CoordinatorMonthTotals[] }
);

type Series = { key: string; label: string; className: string; value: number };

function staffSeries(total: MonthlyStatusTotals): Series[] {
  return [
    { key: "reviewed", label: "Reviewed", className: styles.seriesDark!, value: total.reviewed },
    { key: "toReview", label: "Submitted, not reviewed", className: styles.seriesLight!, value: total.submittedNotReviewed },
    { key: "notSubmitted", label: "Not submitted", className: styles.seriesHatch!, value: total.drafts + total.missing },
    { key: "notDue", label: "Due or upcoming", className: styles.seriesPale!, value: total.due + total.future },
  ];
}

function coordinatorSeries(total: CoordinatorMonthTotals): Series[] {
  return [
    { key: "submitted", label: "Submitted", className: styles.seriesDark!, value: total.submitted },
    { key: "notSubmitted", label: "Not submitted", className: styles.seriesHatch!, value: total.notSubmitted },
    { key: "notDue", label: "Not due yet", className: styles.seriesPale!, value: total.notDue },
  ];
}

/** The chart's text summary, for the SVG description. */
export function recordsChartDescription(props: Pick<RecordsByMonthChartProps, "clubYear" | "variant" | "totals">) {
  const parts = props.totals.map((total) => {
    const series = props.variant === "staff" ? staffSeries(total as MonthlyStatusTotals) : coordinatorSeries(total as CoordinatorMonthTotals);
    return `${shortMonth(total.month)}: ${series.map((entry) => `${number(entry.value)} ${entry.label.toLowerCase()}`).join(", ")}`;
  });
  const clubs = props.totals[0]?.clubs ?? 0;
  return `Stacked column chart of monthly records for ${plural(clubs, "club", "clubs")}, club year ${props.clubYear}, September to August. ${parts.join(". ")}. The same numbers are in the table.`;
}

export function RecordsByMonthChart(props: RecordsByMonthChartProps) {
  const { clubYear, selectedMonth, title = "Records by month", variant } = props;
  const base = safe(useId());
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;
  const hatchId = `${base}-hatch`;
  const rows = props.totals.map((total) => ({
    total,
    series: variant === "staff" ? staffSeries(total as MonthlyStatusTotals) : coordinatorSeries(total as CoordinatorMonthTotals),
  }));
  const legend = rows[0]?.series ?? (variant === "staff"
    ? staffSeries({ month: "", label: "", clubs: 0, submitted: 0, late: 0, reviewed: 0, submittedNotReviewed: 0, drafts: 0, missing: 0, due: 0, future: 0 })
    : coordinatorSeries({ month: "", label: "", clubs: 0, submitted: 0, notSubmitted: 0, notDue: 0 }));
  const max = Math.max(1, ...rows.map((row) => row.total.clubs));
  const height = 100;
  const description = recordsChartDescription(props);
  const fills: Record<string, string> = {
    reviewed: "#003b5c",
    toReview: "#7fa6bd",
    submitted: "#003b5c",
    notSubmitted: `url(#${hatchId})`,
    notDue: "#e6f0f4",
  };

  return (
    <figure aria-labelledby={titleId} className={styles.figure}>
      <figcaption className={styles.caption} id={titleId}>{title} <span className={styles.captionYear}>({clubYear})</span></figcaption>
      <svg aria-describedby={descId} aria-labelledby={`${titleId}-svg`} className={styles.chart} focusable="false" preserveAspectRatio="none" role="img" viewBox={`0 0 120 ${height}`}>
        <title id={`${titleId}-svg`}>{`${title}, club year ${clubYear}`}</title>
        <desc id={descId}>{description}</desc>
        <defs>
          <pattern height="3" id={hatchId} patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="3">
            <rect fill="#ffffff" height="3" width="3" />
            <line stroke="#6b7780" strokeWidth="1" x1="0" x2="0" y1="0" y2="3" />
          </pattern>
        </defs>
        <line stroke="#9aa6ad" strokeWidth="0.5" vectorEffect="non-scaling-stroke" x1="0" x2="120" y1={height} y2={height} />
        {rows.map(({ total, series }, index) => {
          let top = height;
          const selected = total.month === selectedMonth;
          return (
            <g key={total.month}>
              {series.map((entry) => {
                const h = (entry.value / max) * (height - 2);
                top -= h;
                if (h <= 0) return null;
                return (
                  <rect fill={fills[entry.key]} height={h} key={entry.key} stroke="#6b7780" strokeWidth="0.5" vectorEffect="non-scaling-stroke" width="7" x={index * 10 + 1.5} y={top}>
                    <title>{`${total.label}: ${number(entry.value)} ${entry.label.toLowerCase()}`}</title>
                  </rect>
                );
              })}
              {selected && (
                <rect fill="none" height={height - 0.5} stroke="#c8102e" strokeWidth="2" vectorEffect="non-scaling-stroke" width="9" x={index * 10 + 0.5} y="0.25" />
              )}
            </g>
          );
        })}
      </svg>
      <div aria-hidden="true" className={styles.months}>
        {rows.map(({ total }) => (
          <span className={total.month === selectedMonth ? styles.monthSelected : undefined} key={total.month}>{shortMonth(total.month)}</span>
        ))}
      </div>
      {selectedMonth && <p className={styles.selectedNote}>Outlined: {rows.find((row) => row.total.month === selectedMonth)?.total.label ?? selectedMonth}.</p>}
      <ul aria-label="Legend" className={styles.legend}>
        {legend.map((entry) => (
          <li key={entry.key}><span aria-hidden="true" className={`${styles.swatch} ${entry.className}`} />{entry.label}</li>
        ))}
      </ul>
      <details className={styles.details}>
        <summary className={styles.summary}>Show as a table</summary>
        <div aria-label={`${title} for ${clubYear}. Scroll sideways to see every column.`} className={styles.tableWrap} role="region" tabIndex={0}>
          {variant === "staff" ? <StaffTable clubYear={clubYear} title={title} totals={props.totals as readonly MonthlyStatusTotals[]} /> : <CoordinatorTable clubYear={clubYear} title={title} totals={props.totals as readonly CoordinatorMonthTotals[]} />}
        </div>
      </details>
    </figure>
  );
}

function StaffTable({ totals, title, clubYear }: { totals: readonly MonthlyStatusTotals[]; title: string; clubYear: string }) {
  return (
    <table className={`report-table report-table-auto ${styles.table}`}>
      <caption className="sr-only">{title}, {clubYear}: club counts for each month</caption>
      <thead>
        <tr>
          <th scope="col">Month</th><th scope="col">Reviewed</th><th scope="col">Submitted, not reviewed</th>
          <th scope="col">Draft</th><th scope="col">Missing</th><th scope="col">Due or upcoming</th><th scope="col">Total clubs</th><th scope="col">Late (included in submitted)</th>
        </tr>
      </thead>
      <tbody>
        {totals.map((total) => (
          <tr key={total.month}>
            <th scope="row">{total.label}</th>
            <td>{number(total.reviewed)}</td><td>{number(total.submittedNotReviewed)}</td>
            <td>{number(total.drafts)}</td><td>{number(total.missing)}</td><td>{number(total.due + total.future)}</td>
            <td>{number(total.clubs)}</td><td>{number(total.late)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CoordinatorTable({ totals, title, clubYear }: { totals: readonly CoordinatorMonthTotals[]; title: string; clubYear: string }) {
  return (
    <table className={`report-table report-table-auto ${styles.table}`}>
      <caption className="sr-only">{title}, {clubYear}: club counts for each month</caption>
      <thead>
        <tr><th scope="col">Month</th><th scope="col">Clubs</th><th scope="col">Submitted</th><th scope="col">Not submitted</th><th scope="col">Not due yet</th></tr>
      </thead>
      <tbody>
        {totals.map((total) => (
          <tr key={total.month}>
            <th scope="row">{total.label}</th>
            <td>{number(total.clubs)}</td><td>{number(total.submitted)}</td><td>{number(total.notSubmitted)}</td><td>{number(total.notDue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ Points bars */

export type PointsBarsClub = { id: string; name: string; reportPoints: number; totalPoints: number };

export function PointsBars({ clubs, clubYear, hideTable = false, limit = 10, scaleMax, showAllHref, title = "Total points by club", ranks, compact }: {
  clubs: readonly PointsBarsClub[];
  clubYear: string;
  /** The caller renders its own ranking table (#1316), so this one is left out. */
  hideTable?: boolean;
  limit?: number;
  /** Bar scale when `clubs` is only part of the field (a search), so a bar keeps its length. */
  scaleMax?: number;
  showAllHref?: string;
  title?: string;
  /** Rank by club id when `clubs` is a filtered subset, so the table keeps each club's rank in the whole year. */
  ranks?: ReadonlyMap<string, number>;
  /** Opt-in: denser rows and one footer line on phones. */
  compact?: boolean;
}) {
  const base = safe(useId());
  const ranked = sortLeaderboard(clubs, "points");
  const shown = ranked.slice(0, limit);
  const max = Math.max(1, scaleMax ?? 0, ...ranked.map((club) => club.totalPoints));
  const description = `${pointsChartDescription(ranked, clubYear)} Each bar is split into report points and yearly registration points.`
    + (ranked.length > shown.length ? ` The chart shows the top ${shown.length}; the table lists all ${ranked.length}.` : "");
  // With ranks (a search), list positions would contradict the whole-year rank each row announces.
  const BarList = ranks ? "ul" : "ol";
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;
  return (
    <figure aria-describedby={descId} aria-labelledby={titleId} className={styles.figure}>
      <figcaption className={compact ? `${styles.caption} ${styles.captionCompact}` : styles.caption} id={titleId}>
        {title} <span className={styles.captionYear}>({clubYear}{ranked.length > shown.length ? `, top ${shown.length} of ${ranked.length}` : ""})</span>
      </figcaption>
      <p className="sr-only" id={descId}>{description}</p>
      {shown.length === 0 ? <p className={styles.empty}>No active clubs for {clubYear}.</p> : (
        <BarList className={compact ? `${styles.bars} ${styles.barsCompact}` : styles.bars}>
          {shown.map((club) => {
            const registration = club.totalPoints - club.reportPoints;
            return (
              <li className={styles.barRow} key={club.id}>
                <span className={styles.barName} translate="no">{ranks && <span className="sr-only">Rank {ranks.get(club.id)}, </span>}{club.name}</span>
                <span aria-hidden="true" className={styles.barTrack}>
                  <span className={styles.barReport} style={{ width: `${(club.reportPoints / max) * 100}%` }} title={`Report points: ${number(club.reportPoints)}`} />
                  <span className={styles.barRegistration} style={{ width: `${(registration / max) * 100}%` }} title={`Yearly registration: ${number(registration)}`} />
                </span>
                <strong className={styles.barTotal}>{number(club.totalPoints)}<span className="sr-only"> total points</span></strong>
              </li>
            );
          })}
        </BarList>
      )}
      <ul aria-label="Legend" className={styles.legend}>
        <li><span aria-hidden="true" className={`${styles.swatch} ${styles.seriesDark}`} />Report points</li>
        <li><span aria-hidden="true" className={`${styles.swatch} ${styles.seriesLight}`} />Yearly registration</li>
      </ul>
      <div className={compact ? styles.footerCompact : styles.footer}>
      {showAllHref && ranked.length > shown.length && (
        <p className={styles.more}><Link className={styles.moreLink} href={showAllHref}>Show all {number(ranked.length)} clubs</Link></p>
      )}
      {!hideTable && <details className={styles.details}>
        <summary className={styles.summary}>Show as a table</summary>
        <div aria-label={`${title} for ${clubYear}. Scroll sideways to see every column.`} className={styles.tableWrap} role="region" tabIndex={0}>
          <table className={`report-table report-table-auto ${styles.table}`}>
            <caption className="sr-only">{title}, {clubYear}, highest total first</caption>
            <thead>
              <tr><th scope="col">Rank</th><th scope="col">Club</th><th scope="col">Report points</th><th scope="col">Yearly registration</th><th scope="col">Total</th></tr>
            </thead>
            <tbody>
              {ranked.map((club, index) => (
                <tr key={club.id}>
                  <td>{ranks?.get(club.id) ?? index + 1}</td>
                  <th scope="row" translate="no">{club.name}</th>
                  <td>{number(club.reportPoints)}</td>
                  <td>{number(club.totalPoints - club.reportPoints)}</td>
                  <td><strong>{number(club.totalPoints)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>}
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ Year strip */

type StripItem = { month: string; icon: string; word: string; className: string };

function staffItem(cell: MonthCell): StripItem {
  switch (cell.status) {
    case "SUBMITTED":
    case "LATE":
      return cell.reviewed
        ? { month: cell.month, icon: "✓", word: "Reviewed", className: styles.seriesDark! }
        : { month: cell.month, icon: "●", word: "To review", className: styles.seriesLight! };
    case "DRAFT": return { month: cell.month, icon: "✎", word: "Draft", className: styles.stripDraft! };
    case "MISSING": return { month: cell.month, icon: "✕", word: "Missing", className: styles.seriesHatch! };
    case "DUE": return { month: cell.month, icon: "◷", word: "Due", className: styles.stripDue! };
    default: return { month: cell.month, icon: "○", word: "Not yet due", className: styles.seriesPale! };
  }
}

const coordinatorWords: Record<RecordState, { icon: string; word: string; className: string }> = {
  SUBMITTED: { icon: "✓", word: "Submitted", className: styles.seriesDark! },
  NOT_SUBMITTED: { icon: "✕", word: "Not submitted", className: styles.seriesHatch! },
  NOT_DUE: { icon: "○", word: "Not due yet", className: styles.seriesPale! },
};

export type YearStripProps = { selectedMonth?: string; clubName?: string } & (
  | { variant: "staff"; cells: readonly MonthCell[] }
  | { variant: "coordinator"; states: ReadonlyArray<{ month: string; state: RecordState }> }
);

export function YearStrip(props: YearStripProps) {
  const items: StripItem[] = props.variant === "staff"
    ? props.cells.map(staffItem)
    : props.states.map((entry) => ({ month: entry.month, ...coordinatorWords[entry.state] }));
  const label = `${props.clubName ? `${props.clubName}, year` : "Year"} at a glance: ${items.map((item) => `${shortMonth(item.month)} ${item.word}`).join(", ")}.`;
  return (
    <span aria-label={label} className={styles.strip} role="img">
      {items.map((item) => (
        <span aria-hidden="true" className={`${styles.stripCell} ${item.className}${item.month === props.selectedMonth ? ` ${styles.stripSelected}` : ""}`} key={item.month} title={`${shortMonth(item.month)}: ${item.word}`}>
          {item.icon}
        </span>
      ))}
    </span>
  );
}
