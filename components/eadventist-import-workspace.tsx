"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, FileUp } from "lucide-react";
import { cardCell } from "@/components/table-card-labels";
import { HEADER_ACTION_ID, useRegisterOrganizationAction } from "@/components/organization-header-action";
import styles from "@/components/organization-pages.module.css";
import { disbandedNotice, NEW_RECORD, organizationKindLabels } from "@/modules/organizations/eadventist-import";
import type { ImportPreview } from "@/modules/organizations/eadventist-import-repository";

const actionLabels = { NEW: "New", UPDATED: "Updated", UNCHANGED: "Unchanged", SKIPPED: "Skipped" } as const;
const actionTone = { NEW: "green", UPDATED: "purple", UNCHANGED: "", SKIPPED: "gold" } as const;

type ApiError = { message?: string; issues?: Array<{ message?: string }> };

/**
 * Admin upload for the eAdventist organizations export (#649): choose the CSV,
 * review what it would add, update, leave alone, or flag, then save. The file
 * stays in this page's memory and is sent again on save, so the server plans
 * the save from the database as it is then. `initialPreview` starts on an
 * already-read file (render tests). The page header's one filled button chooses
 * the file, and becomes Save once a preview is ready (#1592); it stays focusable
 * and holds clicks back while reading, saving or waiting on a match choice.
 */
export function EadventistImportWorkspace({ initialPreview }: { initialPreview?: ImportPreview }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(initialPreview ?? null);
  const [saved, setSaved] = useState(false);
  // "Possible match" choices: OrganizationID to a stored organization id, or "NEW".
  const [choices, setChoices] = useState<Record<string, string>>({});
  // Which call is running: "check" re-reads the preview (nothing is saved), "save" is the confirming call.
  const [running, setRunning] = useState<"check" | "save" | null>(null);
  const busy = running !== null;
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function send(text: string, confirm: boolean, chosen: Record<string, string> = choices) {
    setRunning(confirm ? "save" : "check");
    setError("");
    try {
      const response = await fetch("/api/admin/organizations/eadventist-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, confirm, choices: chosen }),
      });
      const result = await response.json().catch(() => ({})) as ImportPreview & ApiError;
      if (!response.ok || !result.items) throw new Error(result.message ?? result.issues?.[0]?.message ?? "That file couldn't be read.");
      setPreview(result);
      setSaved(confirm);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That file couldn't be read.");
    } finally {
      setRunning(null);
    }
  }

  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") && !file.type.toLowerCase().startsWith("text/")) {
      setError("Choose a .csv file.");
      return;
    }
    const text = await file.text();
    setCsv(text);
    setSaved(false);
    setChoices({});
    await send(text, false, {});
  }

  const counts = preview?.counts;
  const changes = counts ? counts.new + counts.updated : 0;
  const waiting = preview?.needsChoice ?? 0;

  // The header button's label and what it does follow the step: choose a file, then save what was reviewed.
  const reviewing = Boolean(preview && counts && !saved);
  const saveLabel = `Save ${changes} change${changes === 1 ? "" : "s"}`;
  const latest = useRef<() => void>(() => {});
  // The latest handler is kept in an effect, so the stable `run` the header button calls is never stale.
  useEffect(() => {
    latest.current = () => {
      if (reviewing) { if (csv && changes > 0 && waiting === 0) void send(csv, true); }
      else fileInput.current?.click();
    };
  });
  const run = useCallback(() => latest.current(), []);
  const registerAction = useRegisterOrganizationAction();
  const blocked = reviewing && (!csv || changes === 0 || waiting > 0);
  const label = reviewing ? saveLabel : "Choose CSV file";
  const busyLabel = running === "save" ? "Saving…" : reviewing ? "Checking…" : "Reading…";
  useEffect(() => {
    registerAction({ run, busy, blocked, label, busyLabel });
    return () => registerAction(null);
  }, [registerAction, run, busy, blocked, label, busyLabel]);

  return (
    <section className="panel" aria-labelledby="eadventist-import-title">
      <h2 className={styles.panelTitle} id="eadventist-import-title">{preview && counts ? (saved ? "What was saved" : "Review before saving") : "Choose the file"}</h2>
      <p className={styles.note}>
        Nothing is saved until you review the list and choose Save. Records are matched by their eAdventist OrganizationID, so uploading a newer
        file updates them instead of adding copies. Whether a record is active is never changed by an upload; use the directory list for that.
      </p>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {/* Always mounted, so the header's Choose CSV file button can open the chooser; hidden once a file is being reviewed. */}
      <label className="club-import-upload" hidden={Boolean(preview)}>
        <FileUp aria-hidden="true" size={24} />
        <strong>{busy ? "Reading…" : "Choose the eAdventist organizations CSV"}</strong>
        <input accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={readFile} ref={fileInput} type="file" />
      </label>
      {preview && counts && (
        <>
          <p className={styles.statusLine} data-testid="eadventist-import-summary">
            {saved
              ? <><CheckCircle2 aria-hidden="true" size={14} /> <strong>Saved.</strong> These changes are now in the directory.</>
              : <strong>Nothing is saved yet. These are proposed changes.</strong>}
            {waiting > 0 && <strong>{waiting} possible {waiting === 1 ? "match needs" : "matches need"} a choice before you can save. </strong>}
            {!saved && changes === 0 && waiting === 0 && <span>There is nothing new or changed to save.</span>}
          </p>
          <p className={styles.note}>
            {counts.new} new, {counts.updated} updated, {counts.unchanged} unchanged, {counts.skipped} skipped. {counts.flagged} with a disbanded date on file to review.
            {" "}Church map locations: {preview.locationCounts.created} to create, {preview.locationCounts.updated} to update (town, state and ZIP only; hand-set locations are never changed).
          </p>
          {preview.rejected.length > 0 && (
            <div className="inline-notice" role="status">
              <strong>{preview.rejected.length} {preview.rejected.length === 1 ? "row was" : "rows were"} not read:</strong>
              <ul>
                {preview.rejected.map((row) => <li key={row.line}>Row {row.line}{row.name ? ` (${row.name})` : ""}: {row.reason}</li>)}
              </ul>
            </div>
          )}
          <div className="report-table-wrap">
            <table className="report-table table-cards table-cards-wide" role="table">
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Row</th><th role="columnheader" scope="col">Name</th><th role="columnheader" scope="col">Kind</th><th role="columnheader" scope="col">{saved ? "What was saved" : "Proposed change"}</th></tr></thead>
              <tbody role="rowgroup">
                {preview.items.map((item) => (
                  <tr key={item.line} role="row">
                    <td {...cardCell("Row")}>{item.line}</td>
                    <th className="org-cell-name" role="rowheader" scope="row" translate="no">{item.name}</th>
                    <td {...cardCell("Kind")}>{organizationKindLabels[item.kind]}</td>
                    <td {...cardCell(saved ? "What was saved" : "Proposed change")}>
                      <span className={`status-chip ${actionTone[item.action]}`}>{actionLabels[item.action]}</span>
                      {(item.possibleMatches.length > 0 || item.needsChoice) && <span className="status-chip gold">{item.needsChoice ? "Possible match — choose" : "Possible match"}</span>}
                      <span className={styles.cellNotes}>
                        {item.notes.map((note) => <span key={note}>{note}</span>)}
                      </span>
                      {(item.possibleMatches.length > 0 || item.needsChoice) && !saved && (
                        <select
                          aria-label={`Possible match for ${item.name}`}
                          className={styles.matchSelect}
                          disabled={busy}
                          onChange={(event) => {
                            const next = { ...choices, [item.eadventistId]: event.target.value };
                            setChoices(next);
                            if (csv) void send(csv, false, next);
                          }}
                          value={item.selectedMatch ?? ""}
                        >
                          {item.selectedMatch === null && <option value="">Choose…</option>}
                          {item.possibleMatches.map((match) => <option key={match.id} value={match.id}>Link to {match.name}</option>)}
                          <option value={NEW_RECORD}>Create new</option>
                        </select>
                      )}
                      <span className={styles.cellNotes}>
                        {item.locationAction && <span>{item.locationAction === "CREATE" ? (saved ? "Map location was created." : "Map location will be created.") : (saved ? "Map location was updated." : "Map location will be updated.")}</span>}
                        {item.disbandedOn && <span>{disbandedNotice(item.disbandedOn, true)}</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button className="secondary-button" disabled={busy} onClick={() => { setPreview(null); setCsv(null); setSaved(false); setChoices({}); }} type="button">
              {saved ? "Upload another file" : "Cancel"}
            </button>
            {!saved && (
              <p className={styles.note}>
                Save is at the top of the page.{" "}
                <button className={styles.textButton} onClick={() => document.getElementById(HEADER_ACTION_ID)?.focus()} type="button">Go to Save</button>
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
