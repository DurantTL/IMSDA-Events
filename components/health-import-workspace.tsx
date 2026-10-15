"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, FileUp } from "lucide-react";
import { cardCell } from "@/components/table-card-labels";
import type { ImportApplyResult, ImportPreview, ImportPreviewRow } from "@/modules/health-records/import-repository";

type ApiError = { message?: string };

const outcomeLabels = {
  MATCHED: "Matched",
  NEEDS_CHECK: "Needs check",
  UNMATCHED: "Not matched",
  ALREADY_HAS_RECORD: "Already has a record",
  SUPERSEDED: "Newer entry in this file",
  INCOMPLETE: "Incomplete form",
  IMPORTED: "Imported",
  NOT_SELECTED: "Not selected",
  FAILED: "Could not import",
} as const;

type Outcome = keyof typeof outcomeLabels;

function chipClass(outcome: Outcome) {
  if (outcome === "MATCHED" || outcome === "IMPORTED") return "status-chip green";
  if (outcome === "NEEDS_CHECK" || outcome === "FAILED") return "status-chip gold";
  return "status-chip";
}

async function send(url: string, files: File[], extra: Record<string, string | string[]> = {}) {
  const body = new FormData();
  for (const file of files) body.append("file", file);
  for (const [key, value] of Object.entries(extra)) for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  const response = await fetch(url, { method: "POST", body });
  const result = await response.json().catch(() => ({})) as ApiError & Record<string, unknown>;
  if (!response.ok) throw new Error(result.message ?? "That didn't work. Please try again.");
  return result;
}

/**
 * The Cognito health record import (#878), for a system administrator. The file
 * stays in this browser tab: it is sent to be read for the preview and sent again
 * to apply, and the server stores nothing from it. Nothing on this page shows a
 * medical value, only who matched and which sections are present.
 */
export function HealthImportWorkspace() {
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function readPreview(event: React.FormEvent) {
    event.preventDefault();
    if (files.length === 0) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const { preview: next } = await send("/api/staff/health-import/preview", files) as { preview: ImportPreview };
      setPreview(next);
      setSelected(new Set(next.rows.filter((row) => row.outcome === "MATCHED").map((row) => row.sourceId)));
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "The file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview || selected.size === 0) return;
    setBusy(true);
    setError("");
    try {
      const { result: next } = await send("/api/staff/health-import/apply", files, { include: [...selected] }) as { result: ImportApplyResult };
      setResult(next);
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The import could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(row: Pick<ImportPreviewRow, "sourceId">) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.sourceId)) next.delete(row.sourceId);
      else next.add(row.sourceId);
      return next;
    });
  }

  const matchedCount = preview?.counts.MATCHED ?? 0;
  const rows = result?.rows ?? preview?.rows ?? [];

  return (
    <section className="page-stack health-import">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Health records</p>
          <h2>Import health records from Cognito Forms</h2>
          <p>
            Upload the Cognito export of the <strong>Pathfinder Health Record</strong>: the Excel workbook, or the CSV of each
            sheet. The file isn&apos;t stored. Each entry is matched to a member of this year&apos;s club roster, and the
            records are saved encrypted for the director to review. This page never shows medical values. A member who already
            has a health record is skipped, so you can run the same file again safely.
          </p>
        </div>
      </div>

      {error && <div className="inline-notice error" role="alert">{error}</div>}

      <form className="panel club-import-upload" onSubmit={(event) => void readPreview(event)}>
        <FileUp aria-hidden="true" size={26} />
        <label className="field">
          <span>Export file or files (.xlsx or .csv)</span>
          <input
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            multiple
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []));
              setPreview(null);
              setResult(null);
            }}
            type="file"
          />
        </label>
        <p className="field-help">For CSV, choose the entries file and, if you have them, the emergency contacts and insurance card files together.</p>
        <button className="primary-button" disabled={busy || files.length === 0} type="submit">{busy && !preview ? "Reading..." : "Preview the import"}</button>
      </form>

      {preview && (
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">Preview</p><h2>{preview.total} entries</h2></div></div>
          <p>
            {preview.counts.MATCHED} matched, {preview.counts.NEEDS_CHECK} need a check, {preview.counts.UNMATCHED} not matched,
            {" "}{preview.counts.ALREADY_HAS_RECORD} already have a record, {preview.counts.SUPERSEDED} replaced by a newer entry in
            this file, {preview.counts.INCOMPLETE} incomplete.
            {preview.unreadableRows > 0 && ` ${preview.unreadableRows} rows had no entry id or name and were left out.`}
          </p>
        </section>
      )}

      {rows.length > 0 && (
        <section className="panel">
          <div className="table-wrap">
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Entries in the export and what an import would do with each</caption>
              <thead role="rowgroup">
                <tr role="row">
                  {preview && <th role="columnheader" scope="col"><span className="sr-only">Import</span></th>}
                  <th role="columnheader" scope="col">Name</th>
                  <th role="columnheader" scope="col">Club</th>
                  <th role="columnheader" scope="col">Result</th>
                  <th role="columnheader" scope="col">Sections on the form</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((row) => (
                  <tr role="row" key={row.sourceId}>
                    {preview && (
                      <td {...cardCell("Import")}>
                        {row.outcome === "MATCHED" && (
                          <input aria-label={`Import ${row.name}`} checked={selected.has(row.sourceId)} onChange={() => toggle(row)} type="checkbox" />
                        )}
                      </td>
                    )}
                    <td {...cardCell("Name")} translate="no">{row.name}</td>
                    <td {...cardCell("Club")} translate="no">{row.clubName ?? row.clubText}</td>
                    <td {...cardCell("Result")}>
                      <span className={chipClass(row.outcome as Outcome)}>{outcomeLabels[row.outcome as Outcome]}</span>
                      {row.reason && <span className="field-help"> {row.reason}</span>}
                      {row.needsCorrectionCount > 0 && <span className="field-help"> {row.needsCorrectionCount} {row.needsCorrectionCount === 1 ? "field" : "fields"} will be flagged needs correcting.</span>}
                      {row.contactsOmitted > 0 && <span className="field-help"> {row.contactsOmitted} extra emergency {row.contactsOmitted === 1 ? "contact" : "contacts"} not imported.</span>}
                    </td>
                    <td {...cardCell("Sections on the form")}>{row.sections.length > 0 ? row.sections.map((section) => `${section} ✓`).join(", ") : "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview && (
            <div className="intro-actions">
              <button className="primary-button" disabled={busy || selected.size === 0} onClick={() => void apply()} type="button">
                {busy ? "Importing..." : `Import ${selected.size} of ${matchedCount} matched`}
              </button>
              <span className="field-help">Unmatched people are listed by name only. The director can match them from the club&apos;s side, or the parent can refill the record through the private link.</span>
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">Done</p><h2>Import results</h2></div></div>
          <p>
            {result.counts.IMPORTED === 0 ? <CircleAlert aria-hidden="true" size={16} /> : <CheckCircle2 aria-hidden="true" size={16} />}
            {" "}{result.counts.IMPORTED} imported, {result.counts.ALREADY_HAS_RECORD} already had a record, {result.counts.FAILED} could not be imported,
            {" "}{result.counts.NEEDS_CHECK + result.counts.UNMATCHED} not matched. The run is recorded with counts only.
          </p>
        </section>
      )}

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Afterwards</p><h2>Clean-up checklist</h2></div></div>
        <ul className="checklist">
          <li>Delete the export file you downloaded from Cognito Forms, from your computer and your downloads folder.</li>
          <li>Ask each director to open the Health tab, check the imported records, and confirm them.</li>
          <li>Insurance cards are not imported. Ask parents to upload the card in the new system.</li>
          <li>Once a club&apos;s import is verified, stop using Cognito for that club and delete its entries there.</li>
        </ul>
      </section>
    </section>
  );
}
