"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
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
        `${result?.redeemed ?? 0} meal${result?.redeemed === 1 ? "" : "s"} recorded as served`,
        ...(result?.unredeemed ? [`${result.unredeemed} corrected to not served`] : []),
        ...(result?.review ? [`${result.review} row${result.review === 1 ? "" : "s"} left for review (not saved)`] : []),
      ];
      setDone(`${parts.join(", ")}.`);
      setPreview(null);
      setFile(null);
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
        <input accept=".csv,text/csv" key={file ? file.name : "none"} onChange={chooseFile} type="file" />
        {file && <span className="field-help">{file.name}</span>}
      </label>
      <div className="intro-actions">
        <button className="secondary-button" disabled={busy || !file} onClick={() => void runPreview()} type="button">
          {busy && !preview ? "Reading…" : "Preview"}
        </button>
      </div>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {done && <div className="inline-notice" role="status">{done}</div>}
      {preview && (
        <div className="form-stack" aria-label="Import preview">
          <p role="status">
            <strong>{sourceText[preview.source]}</strong>, {preview.rowCount} row{preview.rowCount === 1 ? "" : "s"}.{" "}
            <strong>{preview.counts.newRedemptions}</strong> new meal{preview.counts.newRedemptions === 1 ? "" : "s"} served.{" "}
            {preview.counts.unchanged} already recorded or unchanged
            {preview.source === "SHEET" ? `, ${preview.counts.notRedeemed} not redeemed` : `, ${preview.counts.notSuccess} not successful scans (ignored)`}.{" "}
            {preview.counts.conflicts} un-redeem conflict{preview.counts.conflicts === 1 ? "" : "s"}. {preview.counts.review} row{preview.counts.review === 1 ? "" : "s"} for review.
          </p>

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
              <h4>Un-redeem conflicts</h4>
              <p className="field-help">
                These tickets are recorded as served, but this file shows them as not redeemed. Nothing changes unless you accept. A correction is
                added as a new record; the earlier one stays.
              </p>
              <div className="report-table-wrap"><table className="report-table report-table-auto">
                <thead><tr><th scope="col">Accept</th><th scope="col">Ticket</th><th scope="col">Row</th><th scope="col">Recorded as served</th></tr></thead>
                <tbody>
                  {preview.conflicts.map((row) => (
                    <tr key={row.ticketNumber}>
                      <td>
                        <input
                          aria-label={`Accept the un-redeem of ${row.ticketId}`}
                          checked={accepted.has(row.ticketNumber)}
                          onChange={(changeEvent) => toggleConflict(row.ticketNumber, changeEvent.target.checked)}
                          type="checkbox"
                        />
                      </td>
                      <td>{row.ticketId}</td>
                      <td>{row.line}</td>
                      <td>{new Date(row.servedAt).toLocaleString("en-US")}</td>
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
              <div className="report-table-wrap"><table className="report-table report-table-auto scanner-import-review">
                <thead><tr><th scope="col">Row</th><th scope="col">Why</th><th scope="col">Detail</th></tr></thead>
                <tbody>
                  {preview.review.map((row) => (
                    <tr key={row.line}>
                      <td>{row.line}</td>
                      <td>{preview.reviewReasons.find((entry) => entry.reason === row.reason)?.label ?? row.reason}</td>
                      <td>{row.summary}</td>
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
