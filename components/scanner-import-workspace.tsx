"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import { FileUp } from "lucide-react";
import type { ScannerImportResult, ScannerPreview } from "@/modules/meals/scanner-import-repository";

const sourceText = { SHEET: "Google Sheet (CSV download)", TRANSACTIONS: "Scanner transactions.csv" } as const;

/**
 * Import café scanner results (#1028). Choose the downloaded Google Sheet (preferred) or the scanner's transactions.csv,
 * preview what it would do, then confirm. Nothing is saved until Confirm, and the confirm step sends the file again so the
 * server can check it still plans exactly what the preview showed.
 */
export function ScannerImportWorkspace({ eventId }: { eventId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ScannerPreview | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  function chooseFile(changeEvent: ChangeEvent<HTMLInputElement>) {
    setFile(changeEvent.target.files?.[0] ?? null);
    setPreview(null);
    setAccepted(new Set());
    setAcknowledge(false);
    setError("");
    setDone("");
  }

  async function post(step: "preview" | "confirm") {
    if (!file) throw new Error("Choose a CSV file.");
    const body = new FormData();
    body.set("step", step);
    body.set("file", file);
    if (step === "confirm" && preview) {
      body.set("digest", preview.digest);
      for (const number of accepted) body.append("accept", String(number));
      if (acknowledge) body.set("acknowledge", "yes");
    }
    const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/meals/scanner-import`, { method: "POST", body });
    const result = await response.json().catch(() => ({})) as { message?: string; preview?: ScannerPreview; result?: ScannerImportResult };
    if (!response.ok) throw new Error(result.message ?? "That could not be done. Nothing was saved.");
    return result;
  }

  async function runPreview() {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const result = await post("preview");
      setPreview(result.preview ?? null);
      setAccepted(new Set());
      setAcknowledge(false);
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "That file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const { result } = await post("confirm");
      const parts = [
        `${result?.redeemed ?? 0} meal${result?.redeemed === 1 ? "" : "s"} recorded as served (including any put back)`,
        ...(result?.unredeemed ? [`${result.unredeemed} corrected to not served`] : []),
        ...(result?.reredeemed ? [`${result.reredeemed} put back as served`] : []),
        ...(result?.review ? [`${result.review} row${result.review === 1 ? "" : "s"} left for review (not saved)`] : []),
      ];
      setDone(`${parts.join(", ")}.`);
      setPreview(null);
      setFile(null);
      // Clear the chosen file without remounting the input, so keyboard focus stays where it is.
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be done. Nothing was saved.");
      // The records changed under the preview, or the file no longer plans the same: ask for a fresh preview.
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  function toggleConflict(number: number, on: boolean) {
    setAccepted((current) => {
      const next = new Set(current);
      if (on) next.add(number);
      else next.delete(number);
      return next;
    });
  }

  const willChange = preview ? preview.counts.newRedemptions + accepted.size : 0;
  const needsAcknowledge = Boolean(preview?.otherSourceHasRedemptions) && !acknowledge;

  return (
    <section className="panel form-stack" aria-labelledby="scanner-import-title">
      <div className="section-heading">
        <div>
          <h3 id="scanner-import-title"><FileUp aria-hidden="true" size={16} /> Import café scanner results</h3>
          <p>
            Preferred: the scanner&rsquo;s Google Sheet, downloaded as CSV. Each row is matched to its ticket by its <strong>ticket_id</strong>.
            Fallback: the scanner&rsquo;s <strong>transactions.csv</strong> (Transactions, Export). It has no ticket id, so a successful scan is
            matched by registration, guest, meal and day, and anything unclear is listed for review instead of saved. Files up to 2 MB.
            You see everything before anything is saved.
          </p>
        </div>
      </div>
      <label>
        CSV file
        <input accept=".csv,text/csv" onChange={chooseFile} ref={inputRef} type="file" />
        {file && <span className="field-help">{file.name}</span>}
      </label>
      <div className="intro-actions">
        <button className="secondary-button" disabled={busy || !file} onClick={() => void runPreview()} type="button">
          {busy && !preview ? "Reading…" : "Preview"}
        </button>
      </div>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {/* Always mounted, so a screen reader announces the result when its text appears. */}
      <div role="status">
        {done && <div className="inline-notice">{done}</div>}
        {preview && (
          <p>
            <strong>{sourceText[preview.source]}</strong>, {preview.rowCount} row{preview.rowCount === 1 ? "" : "s"}, <strong>{preview.matched}</strong> matched to a ticket.{" "}
            <strong>{preview.counts.newRedemptions}</strong> new meal{preview.counts.newRedemptions === 1 ? "" : "s"} served.{" "}
            {preview.counts.unchanged} already recorded or unchanged
            {preview.source === "SHEET" ? `, ${preview.counts.notRedeemed} not redeemed` : `, ${preview.counts.notSuccess} not successful scans (ignored)`}.{" "}
            {preview.counts.conflicts} conflict{preview.counts.conflicts === 1 ? "" : "s"}. {preview.counts.review} row{preview.counts.review === 1 ? "" : "s"} for review.
          </p>
        )}
      </div>
      {preview && (
        <div className="form-stack">

          {preview.otherSourceHasRedemptions && (
            <div className="form-stack">
              <div className="inline-notice error" role="alert">
                This event already holds results from the {preview.source === "SHEET" ? "scanner transactions file" : "Google Sheet"}. The two files
                describe the same scans, and a transactions row has no ticket id, so importing both can count a meal twice. Use one file per period.
              </div>
              <label className="checkbox-row">
                <input checked={acknowledge} onChange={(changeEvent) => setAcknowledge(changeEvent.target.checked)} type="checkbox" />
                <span>I understand and want to import this file anyway.</span>
              </label>
            </div>
          )}

          {preview.conflicts.length > 0 && (
            <div className="form-stack">
              <h4>Conflicts</h4>
              <p className="field-help">
                Un-redeem: recorded as served, but this file shows the ticket as not redeemed. Put back: an earlier correction un-redeemed it, and this
                file shows it served. Nothing changes unless you accept. A correction is a new record; the earlier ones stay.
                {!preview.canAcceptUnredeem && " Accepting an un-redeem lowers the served counts and needs finance access, which you do not have."}
              </p>
              <div className="report-table-wrap"><table role="table" className="report-table report-table-auto table-cards">
                <caption className="sr-only">Conflicts between this file and the recorded results</caption>
                <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Ticket</th><th role="columnheader" scope="col">Accept</th><th role="columnheader" scope="col">Row</th><th role="columnheader" scope="col">Change</th><th role="columnheader" scope="col">Served</th></tr></thead>
                <tbody role="rowgroup">
                  {preview.conflicts.map((row) => (
                    <tr key={row.ticketNumber} role="row">
                      <th role="rowheader" scope="row">{row.ticketId}</th>
                      <td role="cell" data-label="Accept">
                        <label className="checkbox-row">
                          <input
                            checked={accepted.has(row.ticketNumber)}
                            disabled={row.kind === "UNREDEEM" && !preview.canAcceptUnredeem}
                            onChange={(changeEvent) => toggleConflict(row.ticketNumber, changeEvent.target.checked)}
                            type="checkbox"
                          />
                          <span>{row.kind === "UNREDEEM" ? "Un-redeem" : "Put back"}<span className="sr-only"> {row.ticketId}</span></span>
                        </label>
                      </td>
                      <td role="cell" data-label="Row">{row.line}</td>
                      <td role="cell" data-label="Change">{row.kind === "UNREDEEM" ? "Un-redeem" : "Put back as served"}</td>
                      <td role="cell" data-label="Served">{row.servedAtLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}

          {preview.counts.review > 0 && (
            <div className="form-stack">
              <h4>Review list</h4>
              <p className="field-help">
                These rows were not matched to exactly one ticket, so nothing is saved for them. Fix the ticket or the scanner data and import again.
                {" "}{preview.reviewReasons.map((entry) => `${entry.count} ${entry.label.toLowerCase()}`).join(" · ")}
              </p>
              <div className="report-table-wrap"><table role="table" className="report-table report-table-auto table-cards scanner-import-review">
                <caption className="sr-only">Rows left for review</caption>
                <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Row</th><th role="columnheader" scope="col">Why</th><th role="columnheader" scope="col">Detail</th></tr></thead>
                <tbody role="rowgroup">
                  {preview.review.map((row) => (
                    <tr key={row.line} role="row">
                      <th role="rowheader" scope="row">Row {row.line}</th>
                      <td role="cell" data-label="Why">{preview.reviewReasons.find((entry) => entry.reason === row.reason)?.label ?? row.reason}</td>
                      <td role="cell" data-label="Detail">{row.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              {preview.counts.review > preview.reviewShown && (
                <p className="field-help">Showing the first {preview.reviewShown} of {preview.counts.review} rows. The counts above cover them all.</p>
              )}
            </div>
          )}

          <div className="intro-actions">
            <button className="primary-button" disabled={busy || willChange === 0 || needsAcknowledge} onClick={() => void confirm()} type="button">
              {busy ? "Saving…" : `Record ${preview.counts.newRedemptions} served${accepted.size > 0 ? ` and ${accepted.size} correction${accepted.size === 1 ? "" : "s"}` : ""}`}
            </button>
            <button className="text-button" disabled={busy} onClick={() => setPreview(null)} type="button">Cancel</button>
          </div>
          <p className="field-help">Importing the same file again adds nothing.</p>
        </div>
      )}
    </section>
  );
}
