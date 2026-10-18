"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import styles from "@/components/club-orders.module.css";
import { cardCell } from "@/components/table-card-labels";
import { useConfirm } from "@/components/use-confirm";
import { clubClassLevelLabels, type ClubClassLevel } from "@/modules/club-rosters/domain";
import { classLevelsStillToAdd, insigniaNeededByDefault } from "@/modules/earned-awards/domain";
import type { MemberClassHistory as History } from "@/modules/earned-awards/order-source";

const dateLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

type ApiResult = {
  message?: string;
  issues?: Array<{ message?: string }>;
  error?: string;
  removedPendingNeeds?: number;
  keptOrderedNeeds?: number;
};

type Props = {
  history: Pick<History, "firstName" | "lastName" | "entries"> & Partial<Pick<History, "insigniaOnOrder">>;
  /** Only the club's roster roles edit (#1011); everyone else sees the list. */
  canEdit?: boolean;
  organizationId?: string;
  personId?: string;
  /** The server's clock (ISO), so the insignia default and the latest date agree with the server's. */
  nowIso: string;
};

/**
 * A member's class history (#791): completed classes with the date recorded,
 * and the class they are working on. Class levels and dates only. Listed in
 * class order, Friend first. Someone with the roster role (#1011) can also add
 * a class, change a completed class's date, or remove one, with an in-page
 * confirmation. The "in progress" row is the roster's current class and stays
 * read-only.
 */
export function MemberClassHistory({ history, canEdit = false, organizationId = "", personId = "", nowIso }: Props) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const now = new Date(nowIso);
  const today = now.toISOString().slice(0, 10);
  const base = `/api/attendee/clubs/${encodeURIComponent(organizationId)}/class-history/${encodeURIComponent(personId)}`;

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ClubClassLevel | null>(null);
  const [editDate, setEditDate] = useState("");
  const [addLevel, setAddLevel] = useState<ClubClassLevel | "">("");
  const [addDate, setAddDate] = useState("");
  const [insigniaChoice, setInsigniaChoice] = useState<boolean | null>(null);

  const addable = classLevelsStillToAdd(history.entries);
  const insigniaNeeded = insigniaChoice ?? (addDate ? insigniaNeededByDefault(addDate, now) : true);
  const onOrder = new Set(history.insigniaOnOrder ?? []);

  async function send(url: string, method: string, body?: unknown) {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json().catch(() => ({})) as ApiResult;
    if (!response.ok) {
      throw new Error(
        result.error === "MFA_UNLOCK_REQUIRED"
          ? "Confirm it's you again: reload this page and enter your authenticator code."
          : result.message ?? result.issues?.[0]?.message ?? "That could not be saved.",
      );
    }
    return result;
  }

  async function act(run: () => Promise<string>) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      setNotice(await run());
      router.refresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addClass() {
    if (!addLevel || !addDate) return;
    const level = addLevel;
    const ok = await act(async () => {
      await send(base, "POST", { classLevel: level, completedOn: addDate, needsInsignia: insigniaNeeded });
      return `Added ${clubClassLevelLabels[level]}, completed ${dateLabel(addDate)}.${insigniaNeeded ? " Its insignia is suggested on Class tracking; nothing is ordered until you confirm." : ""}`;
    });
    if (ok) {
      setAddLevel("");
      setAddDate("");
      setInsigniaChoice(null);
    }
  }

  async function saveDate(level: ClubClassLevel) {
    const ok = await act(async () => {
      await send(`${base}/${level}`, "PATCH", { completedOn: editDate });
      return `Changed the ${clubClassLevelLabels[level]} date to ${dateLabel(editDate)}.`;
    });
    if (ok) setEditing(null);
  }

  async function removeClass(level: ClubClassLevel) {
    const label = clubClassLevelLabels[level];
    const confirmed = await confirm({
      title: `Remove ${label} from ${history.firstName} ${history.lastName}'s class history?`,
      body: onOrder.has(level)
        ? <p>The {label} class is taken off this person&apos;s history. Its insignia is already on an order, so that order is not changed.</p>
        : <p>The {label} class is taken off this person&apos;s history. If its insignia has not been ordered yet, it is removed from the needs list too.</p>,
      confirmLabel: `Remove ${label}`,
      destructive: true,
    });
    if (!confirmed) return;
    await act(async () => {
      const result = await send(`${base}/${level}`, "DELETE");
      const kept = result.keptOrderedNeeds ?? 0;
      const removed = result.removedPendingNeeds ?? 0;
      return `Removed ${label}.${removed > 0 ? " Its insignia was taken off the needs list." : ""}${kept > 0 ? " Its insignia is already on an order, so that order was left as it is." : ""}`;
    });
  }

  return (
    <section className="public-manage-card page-stack">
      <h2 translate="no">Class history: {history.firstName} {history.lastName}</h2>
      <p className="field-help">
        Classes recorded as completed, and the class this member is working on now. Listed in class order, Friend first.
        {!canEdit && " View only. The club director, deputy or registrar changes class history."}
      </p>
      {notice && <p className="inline-notice success" role="status">{notice}</p>}
      {error && <p className="inline-notice error" role="alert">{error}</p>}
      {history.entries.length === 0 ? (
        <p className="report-empty">No classes are recorded for this member yet.</p>
      ) : (
        <div className="report-table-wrap">
          <table role="table" className="report-table table-cards">
            <caption className="sr-only">Class history for {history.firstName} {history.lastName}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Class</th>
                <th role="columnheader" scope="col">Status</th>
                <th role="columnheader" scope="col">Completed</th>
                {canEdit && <th role="columnheader" scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {history.entries.map((entry) => {
                const isEditing = editing === entry.classLevel;
                return (
                  <tr role="row" key={entry.classLevel}>
                    <th role="rowheader" scope="row">{entry.classLabel}</th>
                    <td {...cardCell("Status")}>{entry.status === "COMPLETED" ? "Completed" : "In progress"}</td>
                    <td {...cardCell("Completed")}>
                      {isEditing ? (
                        <input
                          aria-label={`Completed date for ${entry.classLabel}`}
                          className={styles.date}
                          max={today}
                          onChange={(event) => setEditDate(event.target.value)}
                          type="date"
                          value={editDate}
                        />
                      ) : entry.completedOn ? dateLabel(entry.completedOn) : "—"}
                    </td>
                    {canEdit && (
                      <td {...cardCell("Actions")}>
                        {entry.status !== "COMPLETED" ? "—" : isEditing ? (
                          <span className={styles.actions}>
                            <button className="primary-button" disabled={busy || !editDate || editDate === entry.completedOn} onClick={() => saveDate(entry.classLevel)} type="button">Save date</button>
                            <button className="secondary-button" disabled={busy} onClick={() => setEditing(null)} type="button">Cancel</button>
                          </span>
                        ) : (
                          <span className={styles.actions}>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => { setEditing(entry.classLevel); setEditDate(entry.completedOn ?? ""); setError(""); setNotice(""); }}
                              type="button"
                            >
                              <Pencil aria-hidden="true" size={14} /> Change date<span className="sr-only"> for {entry.classLabel}</span>
                            </button>
                            <button className="text-button" disabled={busy} onClick={() => removeClass(entry.classLevel)} type="button">
                              <Trash2 aria-hidden="true" size={14} /> Remove<span className="sr-only"> {entry.classLabel}</span>
                            </button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <div className="page-stack" data-testid="add-class">
          <h3>Add a class</h3>
          {addable.length === 0 ? (
            <p className="field-help">Every class level is already recorded for this member.</p>
          ) : (
            <>
              <div className={styles.pickerRow}>
                <span className={styles.pickerField}>
                  <label htmlFor="class-history-level">Class</label>
                  <select className={styles.select} id="class-history-level" onChange={(event) => setAddLevel(event.target.value as ClubClassLevel | "")} value={addLevel}>
                    <option value="">Choose a class</option>
                    {addable.map((level) => <option key={level} value={level}>{clubClassLevelLabels[level]}</option>)}
                  </select>
                </span>
                <span className={styles.pickerField}>
                  <label htmlFor="class-history-date">Completed on</label>
                  <input className={styles.date} id="class-history-date" max={today} onChange={(event) => setAddDate(event.target.value)} type="date" value={addDate} />
                </span>
              </div>
              <label className={styles.check}>
                <input checked={insigniaNeeded} onChange={(event) => setInsigniaChoice(event.target.checked)} type="checkbox" />
                This person still needs the insignia
              </label>
              <p className="field-help">
                Ticked, the class&apos;s insignia is suggested on Class tracking, where you confirm what to order, as when you mark a class completed there.
                Unticked, the class is recorded and no insignia is suggested. It starts unticked for a date before this club year.
              </p>
              <div className={styles.actions}>
                <button className="primary-button" disabled={busy || !addLevel || !addDate} onClick={addClass} type="button">
                  <Plus aria-hidden="true" size={16} /> Add class
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {confirmDialog}
    </section>
  );
}
