"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { settingsSaveState } from "@/components/settings-save-state";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import {
  importStatusLabels,
  importStatuses,
  inspectionCsvTemplate,
  inspectionNames,
  type ImportPreview,
} from "@/modules/event-inspections/domain";
import type { InspectionKey } from "@/modules/event-inspections/domain";
import type { InspectionActionResult, InspectionImportResult, InspectionView } from "@/modules/event-inspections/service";
import styles from "@/components/inspection-entry.module.css";

type RowState = { text: string; saved: string; status: "idle" | "saving" | "saved" | "failed"; error: string };
type Message = { tone: "success" | "error"; text: string };

const rowKey = (inspection: InspectionKey, subjectId: string) => `${inspection}:${subjectId}`;
const blankRow: RowState = { text: "", saved: "", status: "idle", error: "" };
/** A save that has not answered after this long is given up on, so a weak connection ends in Retry and not an endless wait. */
export const saveTimeoutMs = 15_000;

/**
 * Inspection scores (#1896) for an Area Coordinator and for staff, one component for both: the server decides who may do
 * what at each endpoint. Built for a phone on a weak connection: one small request for each club's score, a saved or failed
 * mark on each row with a retry, 44px controls, and nothing heavy loaded. A row can only have one save in flight; an answer
 * that arrives late never overwrites what was typed since; a save that does not answer in 15 seconds becomes Retry. The CSV
 * import previews first and applies only the file that was previewed.
 */
export function InspectionEntry({ endpoint, initial, scoringHref }: { endpoint: string; initial: InspectionView; scoringHref: string }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [switching, setSwitching] = useState(false);
  const [switchMessage, setSwitchMessage] = useState<Message | null>(null);
  const [selected, setSelected] = useState<InspectionKey>(initial.inspections[0]?.key ?? "campsite");
  const [rows, setRows] = useState<Record<string, RowState>>(() => Object.fromEntries(initial.entries.map((entry) => [rowKey(entry.inspection, entry.subjectId), { ...blankRow, text: entry.text, saved: entry.text }])));
  const inflight = useRef(new Set<string>());
  const sequence = useRef(new Map<string, number>());
  const caps = initial.capabilities;
  const locked = initial.published && !caps.canCorrectAfterPublish;
  const ready = enabled && initial.scoringEnabled && initial.inspections.length > 0;
  const anyChanged = Object.values(rows).some((row) => row.text.trim() !== row.saved);
  useUnsavedChangesGuard(anyChanged, "You have inspection scores that are not saved. Leave this page and discard them?");

  // After a refresh (switching on, an import) the server's scores replace every box that has nothing unsaved in it. Done while
  // rendering, as React advises for state that follows a prop.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setEnabled(initial.enabled);
    const next = { ...rows };
    for (const entry of initial.entries) {
      const key = rowKey(entry.inspection, entry.subjectId);
      const row = next[key] ?? blankRow;
      if (row.status === "saving" || row.text.trim() !== row.saved) continue;
      next[key] = { ...row, text: entry.text, saved: entry.text };
    }
    setRows(next);
  }

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
      setSwitchMessage({ tone: "success", text: savedMessage(result.enabled ? "The clubs are listed below." : "Turned off. The scores you entered are kept.") });
      router.refresh();
    } catch {
      setSwitchMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setSwitching(false);
    }
  }

  function patchRow(key: string, patch: (row: RowState) => Partial<RowState>) {
    setRows((current) => {
      const row = current[key] ?? blankRow;
      return { ...current, [key]: { ...row, ...patch(row) } };
    });
  }

  async function saveRow(inspection: InspectionKey, subjectId: string, clubName: string, current: RowState) {
    const key = rowKey(inspection, subjectId);
    if (inflight.current.has(key)) return;
    const sent = current.text.trim();
    if (sent === "" && current.saved !== "") {
      const ok = await confirm({
        title: `Remove ${inspectionNames[inspection].toLowerCase()} score`,
        body: <>This removes the saved score of {current.saved} for <span translate="no">{clubName}</span>. You can enter a new one afterwards.</>,
        confirmLabel: "Remove score",
        destructive: true,
      });
      if (!ok) return;
      if (inflight.current.has(key)) return;
    }
    const id = (sequence.current.get(key) ?? 0) + 1;
    sequence.current.set(key, id);
    inflight.current.add(key);
    patchRow(key, () => ({ status: "saving", error: "" }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), saveTimeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveScore", entry: { inspection, subjectId, value: sent === "" ? null : sent } }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({})) as Partial<InspectionActionResult> & { message?: string };
      if (sequence.current.get(key) !== id) return;
      if (!response.ok || !result.saved) {
        patchRow(key, () => ({ status: "failed", error: result.message ?? "Try again." }));
        return;
      }
      const savedText = result.saved.text;
      // What was typed while this saved stays as typed (and shows as not saved yet); only an untouched box takes the saved form.
      patchRow(key, (row) => (row.text.trim() === sent ? { text: savedText, saved: savedText, status: "saved", error: "" } : { saved: savedText, status: "idle", error: "" }));
    } catch (error) {
      if (sequence.current.get(key) !== id) return;
      const timedOut = (error as { name?: string }).name === "AbortError";
      patchRow(key, () => ({ status: "failed", error: timedOut ? "The connection is too slow and the save timed out. Your score is still in the box. Tap Retry." : "No connection. Your score is still in the box. Tap Retry." }));
    } finally {
      clearTimeout(timer);
      inflight.current.delete(key);
    }
  }

  const inspectionName = inspectionNames[selected];
  return (
    <div className={styles.root} data-testid="inspection-entry">
      {confirmDialog}
      {caps.canSwitch ? (
        <div className={styles.block}>
          <div className={styles.row}>
            <p className={styles.state} role="status">Inspections is {enabled ? "on" : "off"}.</p>
            <button className="secondary-button" disabled={switching || (!enabled && !initial.scoringEnabled)} onClick={() => void toggle()} type="button">
              {switching ? "Saving…" : enabled ? "Turn off" : "Turn on"}
            </button>
          </div>
          {switchMessage && <FormMessage message={switchMessage.text} tone={switchMessage.tone} />}
        </div>
      ) : (
        <p className={styles.note}>Inspections is {enabled ? "on" : "off"}. Event administrators, the Clubs Administrator and Area Coordinators turn it on or off.</p>
      )}
      {!initial.scoringEnabled && (
        <p className={styles.note} data-testid="inspection-scoring-off">
          Inspections adds its two scored events to Camporee scoring, which is off for this event. Event administrators, the Clubs Administrator and Area Coordinators can turn it on:{" "}
          <Link href={scoringHref}>open Camporee scoring</Link>. Scores already entered are kept.
        </p>
      )}
      {enabled && initial.scoringEnabled && initial.inspections.length < 2 && (
        <p className={styles.note}>The two inspections are not both set up. Turn Inspections off and on again. If that does not fix it, a scored event in Camporee scoring is named Campsite inspection or Uniform inspection with other settings; rename it first.</p>
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
              <p className={styles.note}>No clubs are registered for this event yet, so there is nobody to score. Clubs appear here as soon as they register; check back then, or ask the Clubs Administrator if a club should already be listed.</p>
            ) : (
              <ul className={styles.clubs}>
                {initial.clubs.map((club) => {
                  const key = rowKey(selected, club.organizationId);
                  const row = rows[key] ?? blankRow;
                  const inputId = `inspection-${selected}-${club.organizationId}`;
                  const statusId = `${inputId}-status`;
                  const changed = row.text.trim() !== row.saved;
                  const saveState = settingsSaveState({ saving: row.status === "saving", dirty: changed, outcome: row.status === "saved" ? "saved" : row.status === "failed" ? "failed" : null });
                  return (
                    <li className={styles.club} key={key}>
                      <form
                        className={styles.clubForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!locked) void saveRow(selected, club.organizationId, club.name, row);
                        }}
                      >
                        <label className={styles.clubName} htmlFor={inputId}>
                          <span className="sr-only">{inspectionName} score for </span>
                          <span translate="no">{club.name}</span>
                        </label>
                        <div className={styles.entry}>
                          <input
                            aria-describedby={statusId}
                            aria-invalid={row.status === "failed"}
                            autoComplete="off"
                            disabled={locked}
                            id={inputId}
                            inputMode="decimal"
                            onChange={(event) => patchRow(key, (current) => ({ text: event.target.value, status: current.status === "saving" ? "saving" : "idle", error: "" }))}
                            value={row.text}
                          />
                          <button className="primary-button" disabled={locked || row.status === "saving" || (!changed && row.status !== "failed")} type="submit">
                            {row.status === "saving" ? "Saving…" : row.status === "failed" ? "Retry" : "Save"}
                            <span className="sr-only">: <span translate="no">{club.name}</span></span>
                          </button>
                        </div>
                        <p aria-live="polite" className={`${styles.status} ${saveState.state === "saved" ? styles.saved : saveState.state === "failed" ? styles.failed : styles.pending}`} id={statusId} role="status">
                          {row.status === "failed" ? notSavedMessage(row.error) : saveState.label}
                        </p>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <ImportSection endpoint={`${endpoint}/import`} locked={locked} onImported={() => router.refresh()} />
        </>
      )}
    </div>
  );
}

function ImportSection({ endpoint, locked, onImported }: { endpoint: string; locked: boolean; onImported: () => void }) {
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
      const { applied, unchanged, failed } = result.result;
      onImported();
      setPreview(null);
      setCsv(null);
      if (fileInput.current) fileInput.current.value = "";
      setMessage(failed.length === 0
        ? { tone: "success", text: savedMessage(`${applied} score${applied === 1 ? "" : "s"} imported${unchanged > 0 ? `, ${unchanged} already the same` : ""}. They are in the boxes above.`) }
        : { tone: "error", text: `${applied} imported, ${failed.length} not saved: ${failed.slice(0, 3).map((item) => `line ${item.line} (${item.message})`).join("; ")}` });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again. Importing the same file again is safe.") });
    } finally {
      setBusy(null);
    }
  }

  const applicable = preview?.rows.filter((row) => row.status === "matched" && row.change !== "same").length ?? 0;
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
                <span><span translate="no">{row.clubName ?? (row.clubText || "(no club)")}</span> · {row.inspection ?? (row.inspectionText || "(no inspection)")} · {row.scoreText || "(no score)"}</span>
                {row.change && <span className={styles.note}>{row.change === "new" ? "Adds a score." : row.change === "same" ? `Same as the score on file (${row.existingText}); nothing changes.` : `Replaces the score on file (${row.existingText}).`}</span>}
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
