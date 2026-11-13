import { useId, type ReactNode } from "react";
import { cardCell } from "@/components/table-card-labels";
import styles from "./analytics-charts.module.css";

/**
 * Generic chart pieces for the public analytics page (#1961). Data in, markup out: nothing here counts or queries. Inline
 * SVG and plain HTML only (no chart library, no scripts). Every chart is a figure with a name, a text summary for screen
 * readers and a "Show as a table" alternative; series differ by line pattern, marker shape and bar fill as well as colour,
 * and a change is an arrow plus words. Colours are the shared tokens only.
 */

const number = (value: number) => value.toLocaleString("en-US");
/** An SVG-safe id fragment from `useId` (its punctuation changes between React versions). */
const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "");

/* ------------------------------------------------------------------ Tiles with change */

export type StatTile = {
  label: string;
  value: string;
  /** The words under the value, like "Up 12% from the previous 30 days". Shown with an arrow for `direction`. */
  change?: { direction: "up" | "down" | "same" | "none"; text: string };
};

function ChangeIcon({ direction }: { direction: "up" | "down" | "same" | "none" }) {
  return (
    <svg aria-hidden="true" className={styles.changeIcon} focusable="false" height="16" viewBox="0 0 16 16" width="16">
      {direction === "up" && <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />}
      {direction === "down" && <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />}
      {direction === "same" && <path d="M3 6h10M3 10h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />}
      {direction === "none" && <path d="M3 8h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />}
    </svg>
  );
}

export function StatTiles({ tiles, label }: { tiles: readonly StatTile[]; label: string }) {
  return (
    <ul aria-label={label} className={styles.tiles}>
      {tiles.map((tile) => (
        <li className={styles.tile} key={tile.label}>
          <span className={styles.tileLabel}>{tile.label}</span>
          <strong className={styles.tileValue}>{tile.value}</strong>
          {tile.change && <span className={styles.change}><ChangeIcon direction={tile.change.direction} /><span>{tile.change.text}</span></span>}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ Shared table alternative */

function DataTable({ title, head, rows }: { title: string; head: readonly string[]; rows: ReadonlyArray<readonly string[]> }) {
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>Show as a table</summary>
      <div className="report-table-wrap">
        <table className={`report-table report-table-auto table-cards ${styles.table}`} role="table">
          <caption className="sr-only">{title}</caption>
          <thead role="rowgroup"><tr role="row">{head.map((label) => <th key={label} role="columnheader" scope="col">{label}</th>)}</tr></thead>
          <tbody role="rowgroup">
            {rows.map((row, index) => (
              <tr key={index} role="row">
                {row.map((cell, cellIndex) => (cellIndex === 0
                  ? <th key={cellIndex} role="rowheader" scope="row">{cell}</th>
                  : <td key={cellIndex} {...cardCell(head[cellIndex] ?? null)}>{cell}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ Trend chart */

export type TrendSeries = { key: string; label: string };
export type TrendPoint = { label: string; values: readonly number[] };

const W = 360;
const H = 200;
const PAD = 10;
/** Dash pattern and marker shape per series position, so the lines never rely on colour alone. */
const lineClasses = [styles.line0, styles.line1, styles.line2] as const;
const markerClasses = [styles.marker0, styles.marker1, styles.marker2] as const;
const fillClasses = [styles.fill0, styles.fill1, styles.fill2] as const;
const dashes = ["", "9 5", "2 5"] as const;

/** A round upper bound for the vertical scale (1, 2, 5 times a power of ten). */
export function niceMax(value: number): number {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * power >= value)!;
  return step * power;
}

function Marker({ shape, x, y, className }: { shape: number; x: number; y: number; className: string }) {
  if (shape === 0) return <circle className={className} cx={x} cy={y} r="4.5" />;
  if (shape === 1) return <rect className={className} height="8" width="8" x={x - 4} y={y - 4} />;
  return <path className={className} d={`M${x} ${y - 5.5}L${x + 5} ${y + 4}L${x - 5} ${y + 4}Z`} />;
}

function LegendSwatch({ index }: { index: number }) {
  return (
    <svg aria-hidden="true" className={styles.swatch} focusable="false" height="14" viewBox="0 0 36 14" width="36">
      <line className={lineClasses[index]} strokeDasharray={dashes[index] || undefined} x1="1" x2="35" y1="7" y2="7" />
      <Marker className={markerClasses[index]!} shape={index} x={18} y={7} />
    </svg>
  );
}

export function TrendChart({ title, series, points, summary, startLabel, endLabel }: {
  title: string;
  series: readonly TrendSeries[];
  points: readonly TrendPoint[];
  /** The text alternative: what the chart shows, in words and numbers. */
  summary: string;
  startLabel: string;
  endLabel: string;
}) {
  const base = safe(useId());
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;
  const max = niceMax(Math.max(0, ...points.flatMap((point) => point.values)));
  const x = (index: number) => (points.length < 2 ? W / 2 : PAD + (index / (points.length - 1)) * (W - PAD * 2));
  const y = (value: number) => H - PAD - (value / max) * (H - PAD * 2);
  const markEvery = Math.max(1, Math.ceil(points.length / 8));
  return (
    <figure aria-describedby={descId} aria-labelledby={titleId} className={styles.figure}>
      <figcaption className={styles.caption} id={titleId}>{title}</figcaption>
      <p className="sr-only" id={descId}>{summary}</p>
      <ul className={styles.legend}>
        {series.map((entry, index) => <li key={entry.key}><LegendSwatch index={index} />{entry.label}</li>)}
      </ul>
      <svg aria-hidden="true" className={styles.chart} focusable="false" viewBox={`0 0 ${W} ${H}`}>
        {[0, 0.5, 1].map((share) => <line className={styles.grid} key={share} x1={PAD} x2={W - PAD} y1={y(max * share)} y2={y(max * share)} />)}
        {series.map((entry, index) => (
          <g key={entry.key}>
            <polyline className={lineClasses[index]} fill="none" points={points.map((point, at) => `${x(at)},${y(point.values[index] ?? 0)}`).join(" ")} strokeDasharray={dashes[index] || undefined} />
            {points.map((point, at) => (at % markEvery === 0 || at === points.length - 1)
              ? <Marker className={markerClasses[index]!} key={at} shape={index} x={x(at)} y={y(point.values[index] ?? 0)} />
              : null)}
          </g>
        ))}
      </svg>
      <p className={styles.axis}><span>{startLabel}</span><span>{`Vertical scale: 0 to ${number(max)}`}</span><span>{endLabel}</span></p>
      <DataTable
        head={["Date", ...series.map((entry) => entry.label)]}
        rows={points.map((point) => [point.label, ...series.map((_, index) => number(point.values[index] ?? 0))])}
        title={`${title}: counts for each date or week`}
      />
    </figure>
  );
}

/* ------------------------------------------------------------------ Bars */

export type FunnelStep = { label: string; value: number; /** Words after the number, like "62% of page views". */ note?: string };

/** A step-by-step funnel as horizontal bars, every bar on the first-largest scale. The numbers are written out beside each bar. */
export function FunnelBars({ title, steps, summary }: { title: string; steps: readonly FunnelStep[]; summary: string }) {
  const base = safe(useId());
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;
  const max = Math.max(1, ...steps.map((step) => step.value));
  return (
    <figure aria-describedby={descId} aria-labelledby={titleId} className={styles.figure}>
      <figcaption className={styles.caption} id={titleId}>{title}</figcaption>
      <p className="sr-only" id={descId}>{summary}</p>
      <ol className={styles.bars}>
        {steps.map((step, index) => (
          <li className={styles.barRow} key={step.label}>
            <span className={styles.barName}>{step.label}</span>
            <span aria-hidden="true" className={styles.barTrack}><span className={`${styles.barFill} ${fillClasses[index % 3]}`} style={{ width: `${(step.value / max) * 100}%` }} /></span>
            <strong className={styles.barValue}>{number(step.value)}{step.note && <span className={styles.barNote}>{step.note}</span>}</strong>
          </li>
        ))}
      </ol>
      <DataTable head={["Step", "Count", "Share of previous step"]} rows={steps.map((step) => [step.label, number(step.value), step.note ?? "Not applicable"])} title={`${title}: count at each step`} />
    </figure>
  );
}

export type BarRow = { key: string; label: string; value: number };

/** Ranked horizontal bars (a top-N list). `empty` shows when there are no rows. */
export function HorizontalBars({ title, valueLabel, rows, summary, empty, nameLabel = "Event" }: { title: string; valueLabel: string; rows: readonly BarRow[]; summary: string; empty: string; /** The first table column heading. */ nameLabel?: string }) {
  const base = safe(useId());
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <figure aria-describedby={descId} aria-labelledby={titleId} className={styles.figure}>
      <figcaption className={styles.caption} id={titleId}>{title}</figcaption>
      <p className="sr-only" id={descId}>{summary}</p>
      {rows.length === 0 ? <p className={styles.empty}>{empty}</p> : (
        <>
          <ol className={styles.bars}>
            {rows.map((row) => (
              <li className={styles.barRow} key={row.key}>
                <span className={styles.barName}>{row.label}</span>
                <span aria-hidden="true" className={styles.barTrack}><span className={`${styles.barFill} ${fillClasses[0]}`} style={{ width: `${(row.value / max) * 100}%` }} /></span>
                <strong className={styles.barValue}>{number(row.value)}<span className="sr-only"> {valueLabel}</span></strong>
              </li>
            ))}
          </ol>
          <DataTable head={[nameLabel, valueLabel]} rows={rows.map((row) => [row.label, number(row.value)])} title={`${title}, most first`} />
        </>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ Inline funnel bar */

/**
 * A small decorative bar trio for a table row: page views, started, completed, on that row's own largest count. Hidden from
 * assistive technology because the row already holds the numbers. The three fills differ in pattern as well as colour.
 */
export function InlineFunnelBar({ views, started, completed }: { views: number; started: number; completed: number }): ReactNode {
  const max = Math.max(1, views, started, completed);
  return (
    <span aria-hidden="true" className={styles.inline}>
      {[views, started, completed].map((value, index) => (
        <span className={styles.inlineTrack} key={index}><span className={`${styles.inlineFill} ${fillClasses[index]}`} style={{ width: `${(value / max) * 100}%` }} /></span>
      ))}
    </span>
  );
}

/** The one-line key for the inline bars (visible text, so it is not colour alone). */
export function InlineFunnelKey() {
  return (
    <p aria-hidden="true" className={styles.inlineKey}>
      {["Page views", "Started", "Completed"].map((label, index) => <span key={label}><span className={`${styles.inlineKeySwatch} ${fillClasses[index]}`} />{label}</span>)}
    </p>
  );
}
