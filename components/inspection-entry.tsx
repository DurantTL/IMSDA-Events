"use client";

import { useRef, useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import {
  importStatusLabels,
  importStatuses,
  inspectionCsvTemplate,
  type ImportPreview,
} from "@/modules/event-inspections/domain";
import type { InspectionKey } from "@/modules/event-inspections/domain";
import type { InspectionActionResult, InspectionImportResult, InspectionView } from "@/modules/event-inspections/service";
import styles from "@/components/inspection-entry.module.css";

type RowState = { text: string; saved: string; status: "idle" | "saving" | "saved" | "failed"; error: string };
type Message = { tone: "success" | "error"; text: string };

const rowKey = (inspection: InspectionKey, subjectId: string) => `${inspection}:${subjectId}`;

/**
 * Inspection scores (#1896) for an Area Coordinator and for staff, one component for both: the server decides who may do
 * what at each endpoint. Built for a phone on a weak connection: one small request for each club's score, a saved or failed
 * mark on each row with a retry, 44px controls, and nothing heavy loaded. The CSV import previews first and applies only
 * the file that was previewed.
 */
export function InspectionEntry({ endpoint, initial }: { endpoint: string; initial: InspectionView }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [switching, setSwitching] = useState(false);
  const [switchMessage, setSwitchMessage] = useState<Message | null>(null);
  const [selected, setSelected] = useState<InspectionKey>(initial.inspections[0]?.key ?? "campsite");
  const [rows, setRows] = useState<Record<string, RowState>>(() => Object.fromEntries(initial.entries.map((entry) => [rowKey(entry.inspection, entry.subjectId), { text: entry.text, saved: entry.text, status: "idle", error: "" } satisfies RowState])));
  const caps = initial.capabilities;
  const locked = initial.published && !caps.canCorrectAfterPublish;
  const ready = enabled && initial.scoringEnabled && initial.inspections.length > 0;

  async function toggle() {
    setSwitching(true);
    setSwitchMessage(null);
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "switch", enabled: !enabled }) });
      const result = await response.json().catch(() => ({})) as Partial<InspectionActionResult> & { message?: string };
      if (!response.ok || typeof result.enabled !== "boolean") {
        setSwitchMessage({ tone: "error", text: notSavedMessage(result.message ?? "Try again.") });
        return;
      }
      setEnabled(result.enabled);
      setSwitchMessage({ tone: "success", text: savedMessage(result.enabled ? "Reload the page to see the clubs." : "Turned off. The scores you entered are kept.") });
      if (result.enabled && initial.inspections.length === 0) window.location.reload();
    } catch {
      setSwitchMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setSwitching(false);
    }
  }

  function patchRow(key: string, patch: Partial<RowState>) {
    setRows((current) => ({ ...current, [key]: { ...(current[key] ?? { text: "", saved: "", status: "idle", error: "" }), ...patch } }));
  }

  async function saveRow(inspection: InspectionKey, subjectId: string) {
    const key = rowKey(inspection, subjectId);
    const text = (rows[key]?.text ?? "").trim();
    patchRow(key, { status: "saving", error: "" });
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveScore", entry: { inspection, subjectId, value: text === "" ? null : text } }),
      });
      const result = await response.json().catch(() => ({})) as Partial<InspectionActionResult> & { message?: string };
      if (!response.ok || !result.saved) {
        patchRow(key, { status: "failed", error: result.message ?? "Try again." });
        return;
      }
      patchRow(key, { status: "saved", text: result.saved.text, saved: result.saved.text, error: "" });
    } catch {
      patchRow(key, { status: "failed", error: "No connection. Your score is still in the box. Tap Retry." });
    }
  }

  return (
    <div className={styles.root} data-testid="inspection-entry">
      {caps.canSwitch ? (
        <div className={styles.block}>
          <div className={styles.row}>
            <p className={styles.state} role="status">Inspections is {enabled ? "on" : "off"}.</p>
            <button className="secondary-button" disabled={switching || (!enabled && !initial.scoringEnabled)} onClick={() => void toggle()} type="button">
              {switching ? "Saving…" : enabled ? "Turn off" : "Turn on"}
            </button>
          </div>
          {!initial.scoringEnabled && <p className={styles.note}>Inspections adds its two scored events to Camporee scoring, so turn Camporee scoring on first.</p>}
          {switchMessage && <FormMessage message={switchMessage.text} tone={switchMessage.tone} />}
        </div>
      ) : (
        <p className={styles.note}>Inspections is {enabled ? "on" : "off"}. Event administrators, the Clubs Administrator and Area Coordinators turn it on or off.</p>
      )}

      {ready && (
        <>
          <div className={styles.block}>
            <h3 className={styles.heading}>Enter scores</h3>
            <div aria-label="Choose an inspection" className={styles.picker} role="group">
              {initial.inspections.map((inspection) => (
                <button aria-pressed={selected === inspection.key} className="secondary-button" key={inspection.key} onClick={() => setSelected(inspection.key)} type="button">
                  {inspection.name}
                </button>
              ))}
            </div>
            {locked && <p className={styles.note}>Results are published. Only the Clubs Administrator or event administrators can correct a score now.</p>}
            {initial.clubs.length === 0 ? (
              <p className={styles.note}>No clubs are registered for this event yet.</p>
            ) : (
              <ul className={styles.clubs}>
                {initial.clubs.map((club) => {
                  const key = rowKey(selected, club.organizationId);
                  const row = rows[key] ?? { text: "", saved: "", status: "idle" as const, error: "" };
                  const inputId = `inspection-${selected}-${club.organizationId}`;
                  const changed = row.text.trim() !== row.saved;
                  return (
                    <li className={styles.club} key={key}>
                      <form
                        className={styles.clubForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!locked && row.status !== "saving") void saveRow(selected, club.organizationId);
                        }}
                      >
                        <label className={styles.clubName} htmlFor={inputId}>{club.name}</label>
                        <div className={styles.entry}>
                          <input
                            autoComplete="off"
                            disabled={locked}
                            id={inputId}
                            inputMode="decimal"
                            onChange={(event) => patchRow(key, { text: event.target.value, status: "idle", error: "" })}
                            value={row.text}
                          />
                          <button className="primary-button" disabled={locked || row.status === "saving" || (!changed && row.status !== "failed")} type="submit">
                            {row.status === "saving" ? "Saving…" : row.status === "failed" ? "Retry" : "Save"}
                            <span className="sr-only">: {club.name}</span>
                          </button>
                        </div>
                        <p aria-live="polite" className={`${styles.status} ${row.status === "saved" ? styles.saved : row.status === "failed" ? styles.failed : styles.pending}`} role="status">
                          {row.status === "saved" ? "Saved." : row.status === "failed" ? `Not saved: ${row.error}` : row.status === "saving" ? "Saving…" : changed ? "Not saved yet." : row.saved !== "" ? "Saved earlier." : ""}
                        </p>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <ImportSection endpoint={`${endpoint}/import`} locked={locked} />
        </>
      )}
      {enabled && !initial.scoringEnabled && <p className={styles.note}>Camporee scoring is off, so inspection scores cannot be entered. Turn Camporee scoring on again; your scores are kept.</p>}
    </div>
  );
}

function ImportSection({ endpoint, locked }: { endpoint: string; locked: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  async function send(body: object) {
    const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({})) as { preview?: ImportPreview; result?: InspectionImportResult; message?: string };
    return { ok: response.ok, result };
  }

  async function chooseFile(file: File | undefined) {
    setPreview(null);
    setMessage(null);
    setCsv(null);
    if (!file) return;
    const text = await file.text().catch(() => null);
    if (text === null) {
      setMessage({ tone: "error", text: "That file could not be read. Choose a CSV file." });
      return;
    }
    setCsv(text);
  }

  async function runPreview() {
    if (csv === null) return;
    setBusy("preview");
    setMessage(null);
    try {
      const { ok, result } = await send({ action: "preview", csv });
      if (!ok || !result.preview) setMessage({ tone: "error", text: result.message ?? "The file could not be previewed. Try again." });
      else setPreview(result.preview);
    } catch {
      setMessage({ tone: "error", text: "Check your connection and try again. Nothing was saved." });
    } finally {
      setBusy(null);
    }
  }

  async function runApply() {
    if (csv === null || !preview) return;
    setBusy("apply");
    setMessage(null);
    try {
      const { ok, result } = await send({ action: "apply", csv, digest: preview.digest });
      if (!ok || !result.result) {
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "Try again.") });
        return;
      }
      const { applied, failed } = result.result;
      setPreview(null);
      setCsv(null);
      if (fileInput.current) fileInput.current.value = "";
      setMessage(failed.length === 0
        ? { tone: "success", text: savedMessage(`${applied} score${applied === 1 ? "" : "s"} imported. Reload the page to see them in the boxes.`) }
        : { tone: "error", text: `${applied} imported, ${failed.length} not saved: ${failed.slice(0, 3).map((item) => `line ${item.line} (${item.message})`).join("; ")}` });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again. Importing the same file again is safe.") });
    } finally {
      setBusy(null);
    }
  }

  const applicable = preview?.counts.matched ?? 0;
  return (
    <div className={styles.import}>
      <h3 className={styles.heading}>Import from a CSV</h3>
      <p className={styles.note}>
        For events that score on paper. The file has the columns <code>club</code>, <code>inspection</code> (campsite or uniform) and <code>score</code>; a <code>club id</code> column is optional.
        Clubs are matched by name among the registered clubs. You see every row before anything is saved.
      </p>
      <div className={styles.actions}>
        <a className="secondary-button" download="inspection-scores-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(inspectionCsvTemplate)}`}>Download a template</a>
      </div>
      <label className={styles.file}>
        CSV file
        <input accept=".csv,text/csv" disabled={locked} onChange={(event) => void chooseFile(event.target.files?.[0])} ref={fileInput} type="file" />
      </label>
      <div className={styles.actions}>
        <button className="secondary-button" disabled={csv === null || busy !== null || locked} onClick={() => void runPreview()} type="button">{busy === "preview" ? "Reading…" : "Preview the file"}</button>
      </div>
      {preview && (
        <>
          <ul className={styles.counts}>
            {importStatuses.filter((status) => preview.counts[status] > 0).map((status) => (
              <li key={status}>{importStatusLabels[status]}: {preview.counts[status]}</li>
            ))}
          </ul>
          <ul className={styles.preview}>
            {preview.rows.map((row) => (
              <li className={styles.previewRow} data-status={row.status} key={row.line}>
                <span className={styles.previewStatus}>Line {row.line}: {importStatusLabels[row.status]}</span>
                <span>{row.clubName ?? (row.clubText || "(no club)")} · {row.inspection ?? (row.inspectionText || "(no inspection)")} · {row.scoreText || "(no score)"}</span>
                {row.message && <span className={styles.note}>{row.message}</span>}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button className="primary-button" disabled={applicable === 0 || busy !== null} onClick={() => void runApply()} type="button">
              {busy === "apply" ? "Importing…" : `Import ${applicable} matched row${applicable === 1 ? "" : "s"}`}
            </button>
          </div>
          <p className={styles.note}>Only matched rows are imported. Fix the others in your file and preview again, or enter them by hand.</p>
        </>
      )}
      {message && <FormMessage message={message.text} tone={message.tone} />}
    </div>
  );
}
