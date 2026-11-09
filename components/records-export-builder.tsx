"use client";

import { useState } from "react";
import { CoordinatorClubPicker } from "@/components/coordinator-club-picker";
import { DisabledHint, disabledHintId } from "@/components/disabled-hint";
import { fileNameFromDisposition } from "@/components/export-link";
import { cardCell } from "@/components/table-card-labels";
import {
  DEFAULT_RECORDS_EXPORT_COLUMN_KEYS,
  RECORDS_EXPORT_CLUB_COLUMN_KEYS,
  RECORDS_EXPORT_LAYOUT_LABELS,
  RECORDS_EXPORT_MONTH_COLUMN_KEYS,
  RECORDS_EXPORT_TOTALS_REFUSED,
  RECORDS_EXPORT_TOTAL_COLUMN_KEYS,
  orderRecordsExportColumns,
  recordsExportHeader,
  type RecordsExportColumnKey,
  type RecordsExportLayout,
} from "@/modules/club-reports/records-export-columns";
import styles from "./records-export-builder.module.css";

type Preview = { headers: string[]; rows: string[][]; totalRows: number };

/**
 * Export Monthly Records (#1761): clubs, a month range, a layout and checkbox groups of columns in one fixed order.
 * Preview shows the first rows (the server caps them); Download CSV is audited. Year totals are one-row-per-club only.
 */
export function RecordsExportBuilder({
  clubYear,
  clubs,
  months,
}: {
  clubYear: string;
  clubs: { id: string; name: string }[];
  months: { value: string; label: string }[];
}) {
  const [clubChoice, setClubChoice] = useState<{ all: boolean; ids: string[] }>({ all: true, ids: [] });
  const [from, setFrom] = useState(months[0]!.value);
  const [to, setTo] = useState(months[months.length - 1]!.value);
  const [layout, setLayout] = useState<RecordsExportLayout>("club");
  const [chosen, setChosen] = useState<RecordsExportColumnKey[]>(DEFAULT_RECORDS_EXPORT_COLUMN_KEYS);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const perClub = layout === "club";
  const totalsActive = perClub;
  // Year totals do not apply to a row per club per month: they are left out of the request, not sent and refused.
  const columns = orderRecordsExportColumns(chosen.filter((key) => perClub || !(RECORDS_EXPORT_TOTAL_COLUMN_KEYS as string[]).includes(key)));
  const rangeProblem = from > to ? "Choose a first month that is no later than the last month." : null;
  const clubsProblem = !clubChoice.all && clubChoice.ids.length === 0 ? "Choose at least one club, or All clubs, to preview or download." : null;
  const columnsProblem = columns.length === 0 ? "Choose at least one column to preview or download." : null;
  const blocked = rangeProblem ?? clubsProblem ?? columnsProblem;

  function setColumn(key: RecordsExportColumnKey, on: boolean) {
    setPreview(null);
    setChosen((current) => (on ? (current.includes(key) ? current : [...current, key]) : current.filter((entry) => entry !== key)));
  }

  function body(forPreview: boolean) {
    return JSON.stringify({
      columns,
      layout,
      clubs: clubChoice.all ? "all" : clubChoice.ids,
      year: clubYear,
      from,
      to,
      preview: forPreview,
    });
  }

  async function request(mode: "preview" | "csv") {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch("/api/attendee/area-clubs/records-export", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: body(mode === "preview"),
      });
      if (mode === "csv" && response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameFromDisposition(response.headers.get("Content-Disposition")) ?? "monthly-records-export.csv";
        link.click();
        URL.revokeObjectURL(url);
        setNotice("Downloaded the Monthly Records export.");
        return;
      }
      const result = await response.json().catch(() => ({})) as Partial<Preview> & { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The export could not be built.");
      if (result.headers && result.rows) setPreview({ headers: result.headers, rows: result.rows, totalRows: result.totalRows ?? result.rows.length });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The export could not be built.");
    } finally {
      setBusy(false);
    }
  }

  function checkboxes(keys: readonly RecordsExportColumnKey[], disabledReason?: string) {
    return (
      <ul className={styles.group}>
        {keys.map((key) => (
          <li key={key}>
            <label className={styles.choice}>
              <input
                aria-describedby={disabledHintId(disabledReason, "records-export-totals-hint")}
                checked={!disabledReason && chosen.includes(key)}
                disabled={Boolean(disabledReason)}
                onChange={(event) => setColumn(key, event.target.checked)}
                type="checkbox"
              />
              {recordsExportHeader(key)}
            </label>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="public-manage-card">
      <h2>Export builder</h2>
      <p className="quiet-copy">Choose the clubs, the months, the layout and the columns. The first choices match the full-year CSV.</p>

      <CoordinatorClubPicker
        allClubs={clubChoice.all}
        clubs={clubs}
        onChange={(next) => { setPreview(null); setClubChoice(next); }}
        selectedIds={clubChoice.ids}
      />

      <fieldset className={styles.section}>
        <legend>Months</legend>
        <div className={styles.range}>
          <label>
            From
            <select onChange={(event) => { setPreview(null); setFrom(event.target.value); }} value={from}>
              {months.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
            </select>
          </label>
          <label>
            To
            <select onChange={(event) => { setPreview(null); setTo(event.target.value); }} value={to}>
              {months.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
            </select>
          </label>
        </div>
        <DisabledHint id="records-export-range-hint" reason={rangeProblem} />
      </fieldset>

      <fieldset className={styles.section}>
        <legend>Layout</legend>
        {(Object.keys(RECORDS_EXPORT_LAYOUT_LABELS) as RecordsExportLayout[]).map((value) => (
          <label className={styles.choice} key={value}>
            <input checked={layout === value} name="records-layout" onChange={() => { setPreview(null); setLayout(value); }} type="radio" />
            {RECORDS_EXPORT_LAYOUT_LABELS[value]}
          </label>
        ))}
      </fieldset>

      <fieldset className={styles.section}>
        <legend>Columns</legend>
        <p className={styles.groupTitle}>Club</p>
        {checkboxes(RECORDS_EXPORT_CLUB_COLUMN_KEYS)}
        <p className={styles.groupTitle}>{perClub ? "Each month (one set of columns per month)" : "Each month (one row per month)"}</p>
        {checkboxes(RECORDS_EXPORT_MONTH_COLUMN_KEYS)}
        <p className={styles.groupTitle}>Year totals</p>
        {checkboxes(RECORDS_EXPORT_TOTAL_COLUMN_KEYS, totalsActive ? undefined : RECORDS_EXPORT_TOTALS_REFUSED)}
        <DisabledHint id="records-export-totals-hint" reason={totalsActive ? null : RECORDS_EXPORT_TOTALS_REFUSED} />
        <p className={styles.help}>Points and item scores appear only for months the club submitted. Draft and missing months are left blank.</p>
      </fieldset>

      {error && <p className="status-chip coral" role="alert">{error}</p>}
      {notice && <p className="status-chip green" role="status">{notice}</p>}

      <DisabledHint id="records-export-hint" reason={blocked} />
      <div className="form-actions">
        <button aria-describedby={disabledHintId(blocked, "records-export-hint")} className="secondary-button" disabled={busy || blocked !== null} onClick={() => request("preview")} type="button">Preview</button>
        <button aria-describedby={disabledHintId(blocked, "records-export-hint")} className="primary-button" disabled={busy || blocked !== null} onClick={() => request("csv")} type="button">Download CSV</button>
      </div>

      {preview && (
        <section aria-labelledby="records-export-preview-heading">
          <h3 id="records-export-preview-heading">
            Preview {preview.totalRows > preview.rows.length ? `(first ${preview.rows.length} of ${preview.totalRows} rows)` : ""}
          </h3>
          <div className="report-table-wrap">
            <table className="report-table table-cards table-cards-xwide" role="table">
              <thead role="rowgroup">
                <tr role="row">{preview.headers.map((header, index) => <th key={index} role="columnheader" scope="col">{header}</th>)}</tr>
              </thead>
              <tbody role="rowgroup">
                {preview.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} role="row">
                    {row.map((cell, cellIndex) => (cellIndex === 0
                      ? <th key={cellIndex} role="rowheader" scope="row">{cell}</th>
                      : <td key={cellIndex} {...cardCell(preview.headers[cellIndex] ?? null)}>{cell}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
