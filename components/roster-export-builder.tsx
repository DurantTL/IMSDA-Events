"use client";

import { useMemo, useState } from "react";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { useConfirm } from "@/components/use-confirm";
import {
  DEFAULT_ROSTER_EXPORT_COLUMNS,
  ROSTER_EXPORT_COLUMNS,
  isGuardianRosterExportColumn,
  rosterExportColumnKeysFor,
  isSensitiveRosterExportColumn,
  sensitiveRosterExportColumns,
  type RosterExportColumn,
  type RosterExportColumnKey,
} from "@/modules/club-rosters/export-columns";
import type { RosterExportFormatRecord } from "@/modules/club-rosters/export-repository";
import { DisabledHint, disabledHintId } from "@/components/disabled-hint";
import { fileNameFromDisposition } from "@/components/export-link";
import { CoordinatorClubPicker } from "@/components/coordinator-club-picker";
import {
  COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS,
  DEFAULT_COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS,
  coordinatorRosterExportHeader,
  isCoordinatorRosterExportColumnKey,
} from "@/modules/club-rosters/coordinator-export-columns";

type PreviewResponse = { headers?: string[]; rows?: string[][]; totalRows?: number; message?: string };
type FormatsResponse = { formats?: RosterExportFormatRecord[]; format?: RosterExportFormatRecord; message?: string };

/** A chosen column: the director's keys, or the coordinator's own allow-list keys (#1760). */
type ChosenColumn = { key: string; header: string };

/** The Area Coordinator's use of this builder (#1760): pick clubs, GET preview and CSV, no renaming, no saved formats, nothing sensitive. */
export type CoordinatorExportSetup = {
  clubs: { id: string; name: string }[];
  initialClubIds: string[];
  clubYear: string;
  /** Start on "Pick clubs" with nothing chosen (a `?club=` that is not an available club). */
  startPicking?: boolean;
  notice?: string;
};

function withDefaultHeader(key: RosterExportColumnKey): RosterExportColumn {
  return { key, header: ROSTER_EXPORT_COLUMNS[key].header };
}

/**
 * The director-facing roster export builder (#490): choose and order
 * columns, rename headers, preview the first rows, download a CSV, and save
 * or reuse a named format. Saved formats hold structure only — never a
 * frozen copy of the roster.
 */
export function RosterExportBuilder({
  organizationId = "",
  canSeeBirthDates = false,
  canSeeGuardians = false,
  initialFormats = [],
  coordinator,
}: {
  organizationId?: string;
  /** Directors and deputies only (#375); a registrar can build an export but never the birth-date column. */
  canSeeBirthDates?: boolean;
  /** Directors and deputies only (#510): everyone else is never offered the guardian columns. */
  canSeeGuardians?: boolean;
  initialFormats?: RosterExportFormatRecord[];
  /** Set for an Area Coordinator (#1760): the same column builder over the coordinator's own column list. */
  coordinator?: CoordinatorExportSetup;
}) {
  const base = `/api/attendee/clubs/${encodeURIComponent(organizationId)}/roster/export`;
  const headerOf = (key: string) => (coordinator
    ? (isCoordinatorRosterExportColumnKey(key) ? coordinatorRosterExportHeader(key) : key)
    : ROSTER_EXPORT_COLUMNS[key as RosterExportColumnKey].header);
  const [clubChoice, setClubChoice] = useState<{ all: boolean; ids: string[] }>({
    all: !coordinator || (!coordinator.startPicking && coordinator.initialClubIds.length === 0),
    ids: coordinator?.initialClubIds ?? [],
  });
  const [columns, setColumns] = useState<ChosenColumn[]>(
    coordinator
      ? DEFAULT_COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS.map((key) => ({ key, header: coordinatorRosterExportHeader(key) }))
      : DEFAULT_ROSTER_EXPORT_COLUMNS,
  );
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][]; totalRows: number } | null>(null);
  const [formats, setFormats] = useState(initialFormats);
  const [formatName, setFormatName] = useState("");
  const [busy, setBusy] = useState(false);
  // Only the format being named is saved work; column picks, headers and the preview just shape a download (#1468).
  useUnsavedChangesGuard(formatName.trim() !== "", "You typed a format name but have not saved it. Leave this page and discard it?");
  const { confirm, confirmDialog } = useConfirm();
  const saveBlocked = !formatName.trim()
    ? "Type a name for the format to save it."
    : columns.length === 0 ? "Choose at least one column to save a format." : null;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const chosenKeys = useMemo(() => new Set(columns.map((column) => column.key)), [columns]);
  const offeredKeys: string[] = useMemo(
    () => (coordinator ? COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS : rosterExportColumnKeysFor(canSeeGuardians)),
    [coordinator, canSeeGuardians],
  );
  const available = offeredKeys.filter((key) => !chosenKeys.has(key));
  // The coordinator list has nothing sensitive to confirm: those columns are simply never offered.
  const sensitiveChosen = coordinator ? [] : sensitiveRosterExportColumns(columns as RosterExportColumn[]);
  const needsConfirmation = sensitiveChosen.length > 0;

  function addColumn(key: string) {
    if (!offeredKeys.includes(key)) return;
    setPreview(null);
    setColumns((current) => (current.some((column) => column.key === key)
      ? current
      : [...current, coordinator ? { key, header: headerOf(key) } : withDefaultHeader(key as RosterExportColumnKey)]));
  }

  function removeColumn(key: string) {
    setPreview(null);
    setColumns((current) => {
      const next = current.filter((column) => column.key !== key);
      if (!coordinator && !sensitiveRosterExportColumns(next as RosterExportColumn[]).length) setConfirmSensitive(false);
      return next;
    });
  }

  const noClubsChosen = Boolean(coordinator) && !clubChoice.all && clubChoice.ids.length === 0;

  /** The coordinator route's JSON body: ordered column keys, the clubs (or "all") and the year. */
  function coordinatorBody(forPreview: boolean) {
    return JSON.stringify({
      columns: columns.map((column) => column.key),
      clubs: clubChoice.all ? "all" : clubChoice.ids,
      year: coordinator?.clubYear,
      preview: forPreview,
    });
  }

  function moveColumn(index: number, delta: -1 | 1) {
    setPreview(null);
    setColumns((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = current.slice();
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function renameHeader(index: number, header: string) {
    setPreview(null);
    setColumns((current) => current.map((column, position) => (position === index ? { ...column, header } : column)));
  }

  async function request(mode: "preview" | "csv") {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = coordinator
        ? await fetch("/api/attendee/area-clubs/roster-export", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: coordinatorBody(mode === "preview"),
        })
        : await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, columns, confirmSensitive }),
        });
      if (mode === "csv" && response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameFromDisposition(response.headers.get("Content-Disposition")) ?? "roster-export.csv";
        link.click();
        URL.revokeObjectURL(url);
        setNotice("Downloaded the roster export.");
        return;
      }
      const result = await response.json().catch(() => ({})) as PreviewResponse;
      if (!response.ok) throw new Error(result.message ?? "The export could not be built.");
      if (result.headers && result.rows) {
        setPreview({ headers: result.headers, rows: result.rows, totalRows: result.totalRows ?? result.rows.length });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The export could not be built.");
    } finally {
      setBusy(false);
    }
  }

  async function saveFormat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formatName.trim()) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch(`${base}/formats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formatName.trim(), columns }),
      });
      const result = await response.json().catch(() => ({})) as FormatsResponse;
      if (!response.ok) throw new Error(result.message ?? "The format could not be saved.");
      if (result.formats) setFormats(result.formats);
      setFormatName("");
      setNotice(`Saved "${formatName.trim()}".`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The format could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function applyFormat(format: RosterExportFormatRecord) {
    setPreview(null);
    setError("");
    setNotice(`Loaded "${format.name}".`);
    // A format saved by someone who could see guardians never brings those columns in for someone who can't (#510).
    const offered = format.columns.filter((column) => canSeeGuardians || !isGuardianRosterExportColumn(column.key));
    setColumns(offered);
    if (!sensitiveRosterExportColumns(offered).length) setConfirmSensitive(false);
  }

  async function deleteFormat(format: RosterExportFormatRecord) {
    if (!(await confirm({
      title: `Delete ${format.name}?`,
      body: <p>The saved format is removed for everyone who can use this export.</p>,
      confirmLabel: `Delete ${format.name}`,
      destructive: true,
    }))) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch(`${base}/formats/${encodeURIComponent(format.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({})) as FormatsResponse;
      if (!response.ok) throw new Error(result.message ?? "The format could not be deleted.");
      if (result.formats) setFormats(result.formats);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The format could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const blockedByBirthDateAccess = !coordinator && columns.some((column) => column.key === "birthDate") && !canSeeBirthDates;
  const clubsHint = noClubsChosen ? "Choose at least one club, or All clubs, to preview or download." : null;
  const canRun = columns.length > 0 && !blockedByBirthDateAccess && (!needsConfirmation || confirmSensitive) && !noClubsChosen;

  return (
    <div className="public-manage-card">
      {confirmDialog}
      <h2>Export builder</h2>
      {coordinator ? (
        <p className="quiet-copy">Choose the clubs, then the columns you need and their order. Preview shows the first rows before you download.</p>
      ) : (
        <p className="quiet-copy">
          Build a CSV for an outside camporee: choose the columns it needs, put them in the order it wants, and rename
          the headers to match its template. Save the structure as a named format to reuse it next time.
        </p>
      )}

      {coordinator?.notice && <p className="status-chip gold" role="status">{coordinator.notice}</p>}
      {coordinator && (
        <CoordinatorClubPicker
          allClubs={clubChoice.all}
          clubs={coordinator.clubs}
          onChange={(next) => { setPreview(null); setClubChoice(next); }}
          selectedIds={clubChoice.ids}
        />
      )}

      {!coordinator && formats.length > 0 && (
        <section aria-labelledby="roster-export-formats-heading">
          <h3 id="roster-export-formats-heading">Saved formats</h3>
          <ul className="roster-export-format-list">
            {formats.map((format) => (
              <li key={format.id}>
                <button className="secondary-button" disabled={busy} onClick={() => applyFormat(format)} type="button">{format.name}</button>
                <button
                  aria-label={`Delete saved format "${format.name}"`}
                  className="text-button"
                  disabled={busy}
                  onClick={() => deleteFormat(format)}
                  type="button"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="roster-export-columns-heading">
        <h3 id="roster-export-columns-heading">Columns</h3>
        {available.length > 0 && (
          <div className="roster-export-add-column">
            <label htmlFor="roster-export-add-column">Add a column</label>
            <select
              id="roster-export-add-column"
              onChange={(event) => {
                if (offeredKeys.includes(event.target.value)) addColumn(event.target.value);
                event.target.value = "";
              }}
              value=""
            >
              <option value="">Choose a column…</option>
              {available.map((key) => (
                <option key={key} value={key}>
                  {headerOf(key)}{!coordinator && isSensitiveRosterExportColumn(key as RosterExportColumnKey) ? " (sensitive)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {columns.length === 0 ? (
          <p className="public-manage-empty">Choose at least one column to build an export.</p>
        ) : (
          <ol className="roster-export-column-list">
            {columns.map((column, index) => (
              <li key={column.key}>
                <span className="roster-export-column-order">{index + 1}</span>
                {coordinator ? (
                  <strong>{column.header}</strong>
                ) : (
                  <label>
                    <span className="sr-only">Header name for {headerOf(column.key)}</span>
                    <input
                      onChange={(event) => renameHeader(index, event.target.value)}
                      type="text"
                      value={column.header}
                    />
                  </label>
                )}
                {!coordinator && isSensitiveRosterExportColumn(column.key as RosterExportColumnKey) && <span className="status-chip gold">Sensitive</span>}
                <div className="roster-export-column-actions">
                  <button aria-label={`Move ${column.header} up`} className="text-button" disabled={index === 0} onClick={() => moveColumn(index, -1)} type="button">↑</button>
                  <button aria-label={`Move ${column.header} down`} className="text-button" disabled={index === columns.length - 1} onClick={() => moveColumn(index, 1)} type="button">↓</button>
                  <button aria-label={`Remove ${column.header}`} className="text-button" onClick={() => removeColumn(column.key)} type="button">Remove</button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {canSeeGuardians && (
        <p className="field-help">
          Emergency contact columns are sensitive. Phone numbers that start with + are exported with a leading apostrophe so
          spreadsheets don&apos;t treat them as formulas.
        </p>
      )}

      {needsConfirmation && (
        <div className="roster-export-confirm status-chip gold">
          <p>
            This export shares {sensitiveChosen.map((column) => column.header).join(", ")}. Only share it with the
            camporee that needs it.
          </p>
          <label>
            <input
              checked={confirmSensitive}
              onChange={(event) => setConfirmSensitive(event.target.checked)}
              type="checkbox"
            />
            {" "}I understand and want to include {sensitiveChosen.map((column) => column.header).join(", ")}.
          </label>
        </div>
      )}

      {blockedByBirthDateAccess && (
        <p className="status-chip coral">Your club role doesn&apos;t include birth dates. Ask your club director.</p>
      )}

      {error && <p className="status-chip coral" role="alert">{error}</p>}
      {notice && <p className="status-chip green" role="status">{notice}</p>}

      <DisabledHint id="roster-export-clubs-hint" reason={clubsHint} />

      <div className="form-actions">
        <button aria-describedby={disabledHintId(clubsHint, "roster-export-clubs-hint")} className="secondary-button" disabled={busy || !canRun} onClick={() => request("preview")} type="button">Preview</button>
        <button aria-describedby={disabledHintId(clubsHint, "roster-export-clubs-hint")} className="primary-button" disabled={busy || !canRun} onClick={() => request("csv")} type="button">Download CSV</button>
      </div>

      {preview && (
        <section aria-labelledby="roster-export-preview-heading">
          <h3 id="roster-export-preview-heading">
            Preview {preview.totalRows > preview.rows.length ? `(first ${preview.rows.length} of ${preview.totalRows})` : ""}
          </h3>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>{preview.headers.map((header, index) => <th key={index}>{header}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!coordinator && <form className="roster-export-save-format" onSubmit={saveFormat}>
        <label htmlFor="roster-export-format-name">Save this column selection as a named format</label>
        <div className="roster-export-save-row">
          <input
            id="roster-export-format-name"
            maxLength={80}
            onChange={(event) => setFormatName(event.target.value)}
            placeholder="e.g. NAD Camporee"
            type="text"
            value={formatName}
          />
          <button aria-describedby={disabledHintId(saveBlocked, "roster-export-save-hint")} className="secondary-button" disabled={busy || !formatName.trim() || columns.length === 0} type="submit">Save format</button>
        </div>
        <DisabledHint id="roster-export-save-hint" reason={saveBlocked} />
      </form>}
    </div>
  );
}
