"use client";

import { useState } from "react";
import { Check, CheckCheck, Eraser } from "lucide-react";
import type { InstructorRosterRow } from "@/modules/honors/instructor-domain";
import { formatPersonName } from "@/lib/person-name";
import { savedMessage } from "@/components/form-message";
import { SortOrderNote, SortableHeader } from "@/components/list-sort";
import { useTableSort, type SortSpec } from "@/components/use-table-sort";

/** Sorts from the headers, in the address (#1458); the roster stays in the server's order until a column is chosen. */
const INSTRUCTOR_ROSTER_SORT = {
  name: { label: "Name", value: (row) => formatPersonName(row, "sorted") },
  club: { label: "Club", value: (row) => row.clubName },
  attended: { label: "Attended", noteLabel: "attended", value: (row) => row.attended },
  completed: { label: "Completed", noteLabel: "completed", value: (row) => row.completed },
} satisfies Record<string, SortSpec<InstructorRosterRow>>;

type MarkResponse = { people?: InstructorRosterRow[]; locked?: number; writeBack?: { skipped: number } | null; message?: string };

/**
 * A class roster the instructor marks (#833): name and club only. Attended and
 * Completed per person, plus one-click "All attended", "All completed" and
 * "Clear". Completed also marks attended. The server decides everything: this
 * only sends the choice and shows what comes back.
 */
export function InstructorRoster({
  offeringId,
  initialRows,
  editable,
  editDeadline,
  notOpenYet = false,
}: {
  offeringId: string;
  initialRows: InstructorRosterRow[];
  editable: boolean;
  editDeadline: string;
  /** The event hasn't started: the roster is readable, marks open on its start. */
  notOpenYet?: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const sorted = useTableSort(rows, INSTRUCTOR_ROSTER_SORT, "roster");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/attendee/honor-instructor/classes/${encodeURIComponent(offeringId)}/marks`;

  async function send(body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as MarkResponse;
      if (!response.ok || !result.people) throw new Error(result.message ?? "The marks could not be saved.");
      setRows(result.people);
      const notes = [
        result.locked ? `${result.locked} already in the honor record were left as they are; ask the conference office to void one if it was a mistake.` : "",
        result.writeBack?.skipped ? `${result.writeBack.skipped} marked completed here have no club roster record to update.` : "",
      ].filter(Boolean);
      setNotice([savedMessage(), ...notes].join(" "));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The marks could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const deadline = new Date(editDeadline).toLocaleDateString("en-US", { dateStyle: "long" });
  const attended = rows.filter((row) => row.attended).length;
  const completed = rows.filter((row) => row.completed).length;

  return (
    <section className="public-manage-card">
      {notOpenYet
        ? <div className="inline-notice error" role="status">Marks open when the event starts. You can already see your roster.</div>
        : editable
        ? <p className="field-help">You can change marks until {deadline}.</p>
        : <div className="inline-notice error" role="status">Marks closed on {deadline}. This roster is read only; ask the conference office if something needs to change.</div>}
      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <p><strong>{rows.length}</strong> in this class · {attended} attended · {completed} completed</p>
      {editable && rows.length > 0 && (
        <p className="club-invite-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void send({ action: "ALL_ATTENDED" })} type="button"><Check aria-hidden="true" size={14} /> All attended</button>
          <button className="primary-button" disabled={busy} onClick={() => void send({ action: "ALL_COMPLETED" })} type="button"><CheckCheck aria-hidden="true" size={14} /> All completed</button>
          <button className="secondary-button" disabled={busy} onClick={() => void send({ action: "CLEAR" })} type="button"><Eraser aria-hidden="true" size={14} /> Clear</button>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="public-manage-empty">No one has chosen this class yet.</p>
      ) : (
        <div className="report-table-wrap">
          {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
          <table className="report-table">
            <caption className="sr-only">People in this class</caption>
            <thead><tr><SortableHeader {...sorted.headerProps("name")} /><SortableHeader {...sorted.headerProps("club")} /><SortableHeader {...sorted.headerProps("attended")} /><SortableHeader {...sorted.headerProps("completed")} /></tr></thead>
            <tbody>
              {sorted.rows.map((row) => (
                <tr key={row.enrollmentId}>
                  <th scope="row" translate="no">{formatPersonName(row, "sorted")}</th>
                  <td translate="no">{row.clubName}</td>
                  <td>
                    <input
                      aria-label={`Attended: ${formatPersonName(row)}`}
                      checked={row.attended}
                      disabled={busy || !editable || row.completed}
                      onChange={(event) => void send({ action: "SET", enrollmentId: row.enrollmentId, attended: event.target.checked })}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Completed: ${formatPersonName(row)}`}
                      checked={row.completed}
                      disabled={busy || !editable || row.recorded}
                      onChange={(event) => void send({ action: "SET", enrollmentId: row.enrollmentId, completed: event.target.checked })}
                      type="checkbox"
                    />
                    {row.recorded && <small> {row.recordedVoided ? "Recorded, later voided by staff" : "In honor record"}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
