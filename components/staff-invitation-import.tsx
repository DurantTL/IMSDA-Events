"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { FileUp } from "lucide-react";
import {
  IMPORT_ROW_STATUS_LABEL,
  IMPORT_ROW_STATUSES,
  MAX_IMPORT_ROWS,
  STAFF_INVITATION_GROUPS,
  STAFF_INVITATION_GROUP_LABEL,
  type ImportPreview,
  type StaffInvitationGroupValue,
} from "@/modules/staff-invitations/domain";
import { formatPersonName } from "@/lib/person-name";

type Props = { eventId: string };

const SHOWN_ROWS = 300;

/**
 * The CSV import (#804). Choose a file (a required email column; optional first name, last name and group), preview what it
 * would do, and confirm. Nothing is created until Confirm, and confirming sends nothing: invitations are sent later, from the
 * list, by a person.
 */
export function StaffInvitationImport({ eventId }: Props) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [defaultGroup, setDefaultGroup] = useState<StaffInvitationGroupValue | "">("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function chooseFile(changeEvent: ChangeEvent<HTMLInputElement>) {
    const file = changeEvent.target.files?.[0];
    setPreview(null);
    setDone("");
    setError("");
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function post(body: Record<string, unknown>) {
    const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/staff-invitations/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({})) as { message?: string; preview?: ImportPreview; result?: { created: number; skipped: number } };
    if (!response.ok) throw new Error(result.message ?? "That couldn't be done. Nothing was created.");
    return result;
  }

  async function runPreview() {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const result = await post({ mode: "preview", csv, defaultGroup: defaultGroup || null });
      setPreview(result.preview ?? null);
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "That couldn't be read.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await post({ mode: "confirm", csv, defaultGroup: defaultGroup || null, digest: preview.digest });
      setDone(`${result.result?.created ?? 0} invitation${result.result?.created === 1 ? "" : "s"} created. Nothing has been sent. Send them from the list below when you are ready.`);
      setPreview(null);
      setCsv("");
      setFileName("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That couldn't be done. Nothing was created.");
      // The list changed under the preview: ask for a fresh one.
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel form-stack" aria-labelledby="staff-invite-import-title">
      <div className="section-heading">
        <div>
          <h3 id="staff-invite-import-title"><FileUp aria-hidden="true" size={16} /> Import a CSV of email addresses</h3>
          <p>
            One column is required: <strong>email</strong>. Optional columns: <strong>first name</strong>, <strong>last name</strong> and
            <strong> group</strong> (Staff, Pastor or Volunteer). Each address gets one personal link. A file with no group column uses the group
            you choose below. Up to {MAX_IMPORT_ROWS} people per file. You will see everything before anything is created, and nothing is emailed.
          </p>
        </div>
      </div>
      <div className="form-grid two-column">
        <label>
          CSV file
          <input accept=".csv,text/csv" onChange={(changeEvent) => void chooseFile(changeEvent)} type="file" />
          {fileName && <span className="field-help">{fileName}</span>}
        </label>
        <label>
          Group for the whole file
          <select onChange={(changeEvent) => { setDefaultGroup(changeEvent.target.value as StaffInvitationGroupValue | ""); setPreview(null); }} value={defaultGroup}>
            <option value="">Use the file&rsquo;s group column</option>
            {STAFF_INVITATION_GROUPS.map((group) => <option key={group} value={group}>{STAFF_INVITATION_GROUP_LABEL[group]}</option>)}
          </select>
          <span className="field-help">Used when the file has no group column, or for a row whose group is blank.</span>
        </label>
      </div>
      <div className="intro-actions">
        <button className="secondary-button" disabled={busy || csv.trim() === ""} onClick={() => void runPreview()} type="button">
          {busy && !preview ? "Reading…" : "Preview"}
        </button>
      </div>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {done && <div className="inline-notice" role="status">{done}</div>}
      {preview && (
        <div className="form-stack" aria-label="Import preview">
          <p role="status">
            <strong>{preview.willCreate}</strong> will be invited.{" "}
            {IMPORT_ROW_STATUSES.filter((status) => status !== "NEW" && preview.counts[status] > 0)
              .map((status) => `${preview.counts[status]} ${IMPORT_ROW_STATUS_LABEL[status].toLowerCase()}`)
              .join(" · ")}
          </p>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr><th scope="col">Line</th><th scope="col">Email</th><th scope="col">Name</th><th scope="col">Group</th><th scope="col">Result</th></tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, SHOWN_ROWS).map((row) => (
                  <tr key={row.line}>
                    <td>{row.line}</td>
                    <td>{row.email || "(blank)"}</td>
                    <td>{formatPersonName(row) || "—"}</td>
                    <td>{row.group ? STAFF_INVITATION_GROUP_LABEL[row.group] : "—"}</td>
                    <td><span className={`status-chip ${row.status === "NEW" ? "green" : row.status === "ALREADY_INVITED" || row.status === "ALREADY_REGISTERED" || row.status === "DUPLICATE_IN_FILE" ? "gold" : "coral"}`}>{IMPORT_ROW_STATUS_LABEL[row.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > SHOWN_ROWS && <p className="field-help">Showing the first {SHOWN_ROWS} of {preview.rows.length} rows. The counts above cover them all.</p>}
          <div className="intro-actions">
            <button className="primary-button" disabled={busy || preview.willCreate === 0} onClick={() => void confirm()} type="button">
              {busy ? "Creating…" : `Create ${preview.willCreate} invitation${preview.willCreate === 1 ? "" : "s"}`}
            </button>
            <button className="text-button" disabled={busy} onClick={() => setPreview(null)} type="button">Cancel</button>
          </div>
          <p className="field-help">Only the rows marked &ldquo;Will be invited&rdquo; are created. Nothing is emailed.</p>
        </div>
      )}
    </section>
  );
}
