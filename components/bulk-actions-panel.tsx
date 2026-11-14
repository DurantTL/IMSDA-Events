"use client";

import { useRef, useState } from "react";
import { FormMessage } from "@/components/form-message";
import { cardCell } from "@/components/table-card-labels";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import type { BulkPreview, BulkSummary, RecentBulkAction } from "@/modules/bulk-actions/repository";
import { OUTCOME_LABELS, OUTCOME_ORDER, type BulkActionKey } from "@/modules/bulk-actions/domain";
import styles from "./bulk-actions-panel.module.css";

type Props = {
  eventId: string;
  queryString: string;
  /** Registrations matching the current filter; null when the filter cannot be used. */
  total: number | null;
  scopeProblem: string | null;
  filters: string[];
  tags: Array<{ id: string; name: string }>;
  /** Tags that can be removed: the active ones and the inactive ones, never recognitions. */
  removableTags: Array<{ id: string; name: string; isActive: boolean }>;
  /** The People list with the same filters, for going back to change them. */
  peopleHref: string;
  /** List filters the link could not carry over (the quick filter and the form answer filter). */
  notCarried: string[];
  canTag: boolean;
  canExport: boolean;
  exportFields: Array<{ key: string; label: string; personal: boolean }>;
  hiddenFieldCount: number;
  limits: { tag: number; export: number };
  recent: RecentBulkAction[];
};

const dateText = (iso: string) => formatInConferenceTime(iso, { dateStyle: "medium", timeStyle: "short" });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The reviewed bulk action flow (#182): choose, preview, confirm, read the outcome. The unit and the scope stay on screen
 * the whole time. The page only follows what the server answers: every permission, limit and version check is the
 * server's, again at confirm.
 */
export function BulkActionsPanel(props: Props) {
  const { eventId, queryString, total, scopeProblem, filters, tags, removableTags, peopleHref, notCarried, canTag, canExport, exportFields, hiddenFieldCount, limits, recent } = props;
  const [action, setAction] = useState<BulkActionKey | "">("");
  const [tagId, setTagId] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  // One key per preview: pressing Confirm twice, or retrying after a lost answer, is the same confirmation.
  const keyRef = useRef<string>("");
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);

  const tagAction = action === "APPLY_TAG" || action === "REMOVE_TAG";
  const ready = action !== "" && (tagAction ? tagId !== "" : fields.length > 0);
  const scopeText = total === null ? "" : `All ${total} ${total === 1 ? "registration" : "registrations"} matching the current filter`;

  function reset() {
    setPreview(null);
    setSummary(null);
    setMessage(null);
  }

  async function runPreview() {
    if (!ready || busy) return;
    setBusy("preview");
    reset();
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/bulk-actions`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params: tagAction ? { tagId } : { fields }, query: queryString }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: data.message ?? "The preview could not be made." });
        return;
      }
      keyRef.current = newKey();
      setPreview(data.preview as BulkPreview);
      window.requestAnimationFrame(() => previewHeading.current?.focus());
    } catch {
      setMessage({ tone: "error", text: "The preview could not be made. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  async function readSummary(runId: string) {
    const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/bulk-actions/${encodeURIComponent(runId)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message ?? "The result could not be read.");
    return data.summary as BulkSummary;
  }

  async function runConfirm() {
    if (!preview || busy) return;
    setBusy("confirm");
    setMessage(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/bulk-actions/${encodeURIComponent(preview.runId)}/confirm`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: keyRef.current }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setMessage({ tone: "error", text: data.message ?? "The action could not be applied. Nothing was changed." });
        return;
      }
      let result: BulkSummary;
      if ((response.headers.get("Content-Type") ?? "").includes("text/csv")) {
        // The file is made once. Save it, then read the run's counts.
        const blob = await response.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = (/filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1]) ?? "bulk-export.csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
        result = await readSummary(preview.runId);
      } else {
        result = ((await response.json()) as { summary: BulkSummary }).summary;
      }
      setSummary(result);
      setPreview(null);
      window.requestAnimationFrame(() => summaryHeading.current?.focus());
    } catch {
      setMessage({ tone: "error", text: "The answer was lost. Press Confirm again to get the result: the same confirmation never applies twice." });
    } finally {
      setBusy(null);
    }
  }

  function toggleField(key: string) {
    reset();
    setFields((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]));
  }

  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-labelledby="bulk-scope-title">
        <h2 className={styles.title} id="bulk-scope-title">What this covers</h2>
        <dl className={styles.facts}>
          <div className={styles.fact}><dt>Record unit</dt><dd>registrations</dd></div>
          <div className={styles.fact}>
            <dt>Scope</dt>
            <dd>{scopeProblem ? scopeProblem : scopeText}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Current filters</dt>
            <dd>{filters.length === 0 ? "None: every registration in this event" : (
              <ul className={styles.list}>{filters.map((line) => <li key={line}>{line}</li>)}</ul>
            )}</dd>
          </div>
        </dl>
        {notCarried.length > 0 && <p className={`${styles.notice} ${styles.warn}`}>The list&apos;s {notCarried.join(" and ")} {notCarried.length > 1 ? "were" : "was"} not carried over. This covers every registration matching the filters above, which may be more than the list showed. <a href={peopleHref}>Go back to the list</a> to check.</p>}
        <p className={styles.sub}>A selection on the list is never widened to the whole filter, and the whole filter is never shortened to fit. Go back to the list to change the filter.</p>
      </section>

      {total === 0 && (
        <section className={styles.card} aria-labelledby="bulk-none-title">
          <h2 className={styles.title} id="bulk-none-title">Nothing to act on</h2>
          <p className={styles.sub}>No registrations match the current filter. <a href={peopleHref}>Go back to the list</a> and change the filters.</p>
        </section>
      )}

      {total !== null && total > 0 && (
        <section className={styles.card} aria-labelledby="bulk-action-title">
          <h2 className={styles.title} id="bulk-action-title">1. Choose an action</h2>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Action</legend>
            {canTag && (
              <>
                <label className={styles.choice}><input type="radio" name="bulk-action" checked={action === "APPLY_TAG"} onChange={() => { reset(); setAction("APPLY_TAG"); }} /> Apply a tag</label>
                <label className={styles.choice}><input type="radio" name="bulk-action" checked={action === "REMOVE_TAG"} onChange={() => { reset(); setAction("REMOVE_TAG"); }} /> Remove a tag</label>
              </>
            )}
            {canExport && <label className={styles.choice}><input type="radio" name="bulk-action" checked={action === "EXPORT_FIELDS"} onChange={() => { reset(); setAction("EXPORT_FIELDS"); }} /> Export selected fields (CSV)</label>}
          </fieldset>
          {!canTag && !canExport && <p className={styles.empty}>Your event role does not include any bulk action. Ask your event administrator if you need one.</p>}
          <p className={styles.help}>Refunds, cancellations, transfers, identity merges, lodging and session assignments, and payment, price or capacity changes are not bulk actions. Use their own pages.</p>

          {tagAction && (
            <label className={styles.field}>
              Tag
              <select value={tagId} onChange={(event) => { reset(); setTagId(event.target.value); }}>
                <option value="">Choose a tag</option>
                {(action === "REMOVE_TAG" ? removableTags : tags).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}{"isActive" in tag && !tag.isActive ? " (inactive)" : ""}</option>)}
              </select>
              <span className={styles.help}>Up to {limits.tag} registrations at a time.</span>
            </label>
          )}
          {action === "EXPORT_FIELDS" && (
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Fields to include</legend>
              {exportFields.map((field) => (
                <label key={field.key} className={styles.choice}>
                  <input type="checkbox" checked={fields.includes(field.key)} onChange={() => toggleField(field.key)} /> {field.label}{field.personal ? " (personal data)" : ""}
                </label>
              ))}
              {hiddenFieldCount > 0 && <p className={styles.help}>Some fields need access your role does not have, so they are not offered.</p>}
              <p className={styles.help}>Up to {limits.export} registrations at a time. Health, medical, consent, note and insurance information is never included.</p>
            </fieldset>
          )}
          <div className={styles.actions}>
            <button type="button" className="primary-button" onClick={runPreview} disabled={!ready || busy !== null} aria-busy={busy === "preview" || undefined}>
              {busy === "preview" ? "Previewing…" : "Preview"}
            </button>
          </div>
        </section>
      )}

      <FormMessage tone={message?.tone ?? "success"} message={message?.text ?? ""} alwaysMounted />

      {preview && (
        <section className={styles.card} aria-labelledby="bulk-preview-title">
          <h2 className={styles.title} id="bulk-preview-title" tabIndex={-1} ref={previewHeading}>2. Review the preview</h2>
          <dl className={styles.facts}>
            <div className={styles.fact}><dt>Action</dt><dd>{preview.actionLabel}</dd></div>
            <div className={styles.fact}><dt>Proposed change</dt><dd>{preview.proposedChange}. {preview.effect}</dd></div>
            <div className={styles.fact}><dt>Scope</dt><dd>{scopeText}. Record unit: {preview.recordUnit}.</dd></div>
            <div className={styles.fact}><dt>Candidates</dt><dd>{plural(preview.candidateCount, "registration")}, of which {preview.willChangeCount} would be {preview.createsFile ? "exported" : "changed"}.</dd></div>
            <div className={styles.fact}>
              <dt>Skipped or excluded</dt>
              <dd>{preview.exclusions.length === 0 && preview.scope.notInScopeCount === 0 ? "None." : (
                <ul className={styles.list}>
                  {preview.exclusions.map((group) => <li key={group.reason}>{plural(group.count, "registration")}: {group.label}{group.sampleCodes.length > 0 ? ` (${group.sampleCodes.join(", ")}${group.count > group.sampleCodes.length ? ", …" : ""})` : ""}</li>)}
                  {preview.scope.notInScopeCount > 0 && <li>{plural(preview.scope.notInScopeCount, "selected registration")} not in the current filter.</li>}
                </ul>
              )}</dd>
            </div>
            <div className={styles.fact}><dt>Conflicts</dt><dd>None yet. A registration that changes before you confirm is left alone and reported.</dd></div>
            <div className={styles.fact}><dt>Permissions used</dt><dd>{preview.permissionsUsed.join(", ")}. They are checked again when you confirm.</dd></div>
          </dl>
          {preview.createsFile && (
            <p className={`${styles.notice} ${styles.warn}`}>
              Confirming creates a file{preview.personalFields.length > 0 ? ` with personal data (${preview.personalFields.join(", ")})` : ""}. The file is made once and is not kept. Store it securely and delete it when you are done.
            </p>
          )}
          <p className={styles.sub}>This preview is good until {dateText(preview.expiresAt)}.</p>
          <div className={styles.actions}>
            <button type="button" className="primary-button" onClick={runConfirm} disabled={busy !== null} aria-busy={busy === "confirm" || undefined}>
              {busy === "confirm" ? "Applying…" : preview.createsFile ? "Confirm and create the file" : "Confirm and apply"}
            </button>
            <button type="button" className="secondary-button" onClick={reset} disabled={busy !== null}>Cancel</button>
          </div>
        </section>
      )}

      {summary && (
        <section className={styles.card} aria-labelledby="bulk-summary-title">
          <h2 className={styles.title} id="bulk-summary-title" tabIndex={-1} ref={summaryHeading}>3. Result</h2>
          <p className={styles.sub}>
            {summary.actionLabel} for {summary.scope.kind === "SELECTED" ? "the selected" : "all"} {summary.recordUnit} matching the filter. {summary.replayed ? "This is the stored result of an earlier confirmation; nothing was applied again." : ""}
            {summary.exportRowCount !== null ? ` ${plural(summary.exportRowCount, "row")} exported.` : ""}
          </p>
          <ul className={styles.counts}>
            {OUTCOME_ORDER.map((outcome) => (
              <li className={styles.count} key={outcome}>
                <span className={styles.countNumber}>{summary.counts[outcome.toLowerCase() as keyof BulkSummary["counts"]]}</span>
                {OUTCOME_LABELS[outcome]}
              </li>
            ))}
          </ul>
          {summary.notCompleted.length > 0 && (
            <div className="report-table-wrap">
              <table role="table" className="report-table table-cards">
                <caption className="sr-only">Registrations that were not completed, by confirmation code</caption>
                <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Confirmation code</th><th role="columnheader" scope="col">What happened</th><th role="columnheader" scope="col">Why</th></tr></thead>
                <tbody role="rowgroup">
                  {summary.notCompleted.map((row) => (
                    <tr role="row" key={row.confirmationCode}><th role="rowheader" scope="row">{row.confirmationCode}</th><td {...cardCell("What happened")}>{OUTCOME_LABELS[row.outcome]}</td><td {...cardCell("Why")}>{row.reason}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {summary.notCompletedTotal > summary.notCompleted.length && <p className={styles.help}>{summary.notCompletedTotal - summary.notCompleted.length} more are not listed here. The counts above include them.</p>}
        </section>
      )}

      <section className={styles.card} aria-labelledby="bulk-recent-title">
        <h2 className={styles.title} id="bulk-recent-title">Recent bulk actions</h2>
        {recent.length === 0 ? <p className={styles.empty}>No bulk actions have been run for this event yet.</p> : (
          <div className="report-table-wrap">
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">The last bulk actions for this event, newest first</caption>
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">When</th><th role="columnheader" scope="col">Who</th><th role="columnheader" scope="col">Action</th><th role="columnheader" scope="col">Scope</th><th role="columnheader" scope="col">Result</th></tr></thead>
              <tbody role="rowgroup">
                {recent.map((run) => (
                  <tr role="row" key={run.runId}>
                    <th role="rowheader" scope="row">{dateText(run.previewedAt)}</th>
                    <td {...cardCell("Who")}>{run.actorName}</td>
                    <td {...cardCell("Action")}>{run.actionLabel}</td>
                    <td {...cardCell("Scope")}>{run.scope.kind === "SELECTED" ? "Selection within " : ""}{plural(run.candidateCount, "registration")}{run.scope.filters.length > 0 ? `: ${run.scope.filters.join("; ")}` : ""}</td>
                    <td {...cardCell("Result")}>{run.status === "APPLIED" ? `${run.counts.completed} completed, ${run.counts.skipped} skipped, ${run.counts.conflict} changed, ${run.counts.failed} failed, ${run.counts.obsolete} no longer matching` : run.status === "APPLYING" ? "Being applied" : run.status === "EXPIRED" ? "Preview expired, nothing changed" : "Previewed, not confirmed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
