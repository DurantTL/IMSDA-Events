"use client";

import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { ROLE_LABELS, activityGaps, type ActivityView, type AssignmentView } from "@/modules/event-staffing/domain";
import type { EventTltOption } from "@/modules/event-staffing/tlt-director";
import styles from "@/components/tlt-staffing.module.css";

const TLT_YEARS = [1, 2, 3, 4];

/**
 * One event's TLT staffing for the TLT director (#1678): each activity's TLTs needed, assigned and still short, and the event's
 * registered TLTs to filter by help-area tag, TLT year and club. Presentation only: the page already checked access, and the
 * server checks again that each person is registered for the event and is a current TLT. Results are announced in one polite
 * status region.
 */
export function TltStaffing({ endpoint, initialActivities, options }: { endpoint: string; initialActivities: ActivityView[]; options: EventTltOption[] }) {
  const [activities, setActivities] = useState(initialActivities);
  const [tag, setTag] = useState("");
  const [year, setYear] = useState("");
  const [club, setClub] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<{ activity: ActivityView; person: AssignmentView } | null>(null);
  const [dialogError, setDialogError] = useState("");

  const tags = useMemo(() => [...new Map(options.flatMap((option) => option.tags).map((entry) => [entry.id, entry.name])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "en-US")), [options]);
  const clubs = useMemo(() => [...new Map(options.map((option) => [option.clubId, option.clubName])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "en-US")), [options]);
  const shown = options.filter((option) => (!tag || option.tags.some((entry) => entry.id === tag)) && (!year || String(option.tltYear ?? "") === year) && (!club || option.clubId === club));
  const heldBy = (personId: string) => activities.filter((activity) => activity.assignments.some((assignment) => assignment.kind === "person" && assignment.assigneeId === personId));
  const nameOf = (personId: string) => options.find((option) => option.personId === personId)?.name;

  async function send(method: "POST" | "DELETE", body: object): Promise<ActivityView | null> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { activity?: ActivityView; message?: string };
      if (!response.ok || !result.activity) {
        const text = notSavedMessage(result.message ?? "Try again.");
        if (confirming) setDialogError(text);
        else setMessage({ tone: "error", text });
        return null;
      }
      return result.activity;
    } catch {
      const text = notSavedMessage("Check your connection and try again.");
      if (confirming) setDialogError(text);
      else setMessage({ tone: "error", text });
      return null;
    } finally {
      setBusy(false);
    }
  }

  const replace = (saved: ActivityView) => setActivities((current) => current.map((activity) => (activity.id === saved.id ? saved : activity)));

  async function assign(option: EventTltOption) {
    const activityId = choice[option.personId];
    if (!activityId) {
      setMessage({ tone: "error", text: notSavedMessage(`Choose an activity for ${option.name}.`) });
      return;
    }
    const saved = await send("POST", { activityId, role: "TLT", assignee: { kind: "person", id: option.personId } });
    if (!saved) return;
    replace(saved);
    setChoice((current) => ({ ...current, [option.personId]: "" }));
    setMessage({ tone: "success", text: savedMessage(`${option.name} is on ${saved.name}.`) });
  }

  async function remove(activity: ActivityView, person: AssignmentView) {
    const saved = await send("DELETE", { id: person.id });
    if (!saved) return;
    replace(saved);
    setConfirming(null);
    setDialogError("");
    setMessage({ tone: "success", text: savedMessage(`${person.name} is off ${activity.name}.`) });
  }

  const totalNeeded = activities.reduce((total, activity) => total + activity.tltsNeeded, 0);
  const totalAssigned = activities.reduce((total, activity) => total + activity.assignments.filter((assignment) => assignment.role === "TLT" && assignment.active).length, 0);

  return (
    <div className={styles.block}>
      <FormMessage alwaysMounted message={message?.text ?? ""} tone={message?.tone ?? "success"} />

      <section className={styles.block} aria-labelledby="tlt-activities-heading">
        <h3 className={styles.heading} id="tlt-activities-heading">Activities</h3>
        {activities.length === 0 ? (
          <p className={styles.empty}>Nobody has added an activity to this event yet. The event&apos;s Area Coordinator or administrator adds them on the staffing sheet.</p>
        ) : (
          <>
            <p className={styles.counts}>TLTs: {totalAssigned} of {totalNeeded} assigned across {activities.length} {activities.length === 1 ? "activity" : "activities"}.</p>
            <ul className={styles.activities}>
              {activities.map((activity) => {
                const assigned = activity.assignments.filter((assignment) => assignment.role === "TLT");
                const gap = activityGaps(activity).find((entry) => entry.role === "TLT");
                const detail = [activity.timeText, activity.location].filter(Boolean).join(" · ");
                return (
                  <li className={styles.activity} key={activity.id}>
                    <h4 className={styles.activityName}>{activity.name}</h4>
                    {detail && <p className={styles.details}>{detail}</p>}
                    <p className={styles.counts}>TLTs needed: {activity.tltsNeeded} · assigned: {assigned.filter((person) => person.active).length}</p>
                    {gap ? <p className={styles.gap}>Needs: {gap.shortText}</p> : activity.tltsNeeded > 0 ? <p className={styles.done}>All TLTs assigned.</p> : null}
                    {assigned.length > 0 && (
                      <ul className={styles.people}>
                        {assigned.map((person) => (
                          <li className={styles.person} key={person.id}>
                            <span><span className={styles.personName}>{person.name}</span> <span className={styles.role}>({ROLE_LABELS.TLT}{person.active ? "" : ", no longer on the event"})</span></span>
                            <button className={`secondary-button ${styles.removeButton}`} disabled={busy} onClick={() => { setDialogError(""); setConfirming({ activity, person }); }} type="button">
                              Remove<span className="sr-only">: {person.name} from {activity.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className={styles.block} aria-labelledby="tlt-registered-heading">
        <h3 className={styles.heading} id="tlt-registered-heading">Registered TLTs</h3>
        {options.length === 0 ? (
          <p className={styles.empty}>No current TLT is registered for this event yet.</p>
        ) : (
          <>
            <div className={styles.filters}>
              <label className={styles.field}>Help-area tag
                <select value={tag} onChange={(event) => setTag(event.target.value)}>
                  <option value="">All tags</option>
                  {tags.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </label>
              <label className={styles.field}>TLT year
                <select value={year} onChange={(event) => setYear(event.target.value)}>
                  <option value="">All years</option>
                  {TLT_YEARS.map((value) => <option key={value} value={String(value)}>Year {value}</option>)}
                </select>
              </label>
              <label className={styles.field}>Club
                <select value={club} onChange={(event) => setClub(event.target.value)}>
                  <option value="">All clubs</option>
                  {clubs.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </label>
            </div>
            <p className={styles.counts} role="status">{shown.length} of {options.length} registered {options.length === 1 ? "TLT" : "TLTs"} shown.</p>
            <ul className={styles.tlts}>
              {shown.map((option) => {
                const held = heldBy(option.personId);
                const free = activities.filter((activity) => !held.some((entry) => entry.id === activity.id));
                const selectId = `tlt-activity-${option.personId}`;
                return (
                  <li className={styles.tlt} key={option.personId}>
                    <h4 className={styles.tltName}>{option.name}</h4>
                    <p className={styles.details}>{option.tltYear ? `Year ${option.tltYear}` : "Year not set"} · {option.clubName}</p>
                    {option.tags.length > 0 ? (
                      <ul className={styles.tags} aria-label={`Help-area tags for ${option.name}`}>{option.tags.map((entry) => <li className={styles.tag} key={entry.id}>{entry.name}</li>)}</ul>
                    ) : <p className={styles.details}>No help-area tags yet.</p>}
                    {held.length > 0 && <p className={styles.details}>On this event: {held.map((activity) => activity.name).join(", ")}</p>}
                    {free.length > 0 && (
                      <div className={styles.assignRow}>
                        <label className={styles.field} htmlFor={selectId}>Activity<span className="sr-only"> for {option.name}</span>
                          <select id={selectId} value={choice[option.personId] ?? ""} onChange={(event) => setChoice((current) => ({ ...current, [option.personId]: event.target.value }))}>
                            <option value="">Choose an activity</option>
                            {free.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                          </select>
                        </label>
                        <button className="primary-button" disabled={busy} onClick={() => void assign(option)} type="button">Assign<span className="sr-only"> {option.name} as a TLT</span></button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <ConfirmDialog
        busy={busy}
        busyLabel="Removing…"
        confirmLabel="Remove TLT"
        destructive
        error={dialogError}
        onCancel={() => { setConfirming(null); setDialogError(""); }}
        onConfirm={() => { if (confirming) void remove(confirming.activity, confirming.person); }}
        open={confirming !== null}
        title="Take this TLT off the activity?"
      >
        {confirming && <p>{nameOf(confirming.person.assigneeId) ?? confirming.person.name} comes off {confirming.activity.name}. You can assign them again.</p>}
      </ConfirmDialog>
    </div>
  );
}
