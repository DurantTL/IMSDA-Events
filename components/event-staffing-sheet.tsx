"use client";

import { Download, Printer } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import {
  ASSIGNABLE_ROLES,
  MAX_NAME_LENGTH,
  MAX_NEEDED,
  MAX_TEXT_LENGTH,
  ROLE_LABELS,
  activityGaps,
  roleCounts,
  summarizeStaffing,
  type ActivityView,
  type AssignmentView,
  type StaffingRole,
} from "@/modules/event-staffing/domain";
import type { PickerPerson } from "@/modules/event-staffing/repository";
import styles from "@/components/event-staffing-sheet.module.css";

type Draft = { id: string | null; name: string; description: string; location: string; timeText: string; tltsNeeded: string; lifeguardsNeeded: string; helpersNeeded: string };
const blankDraft: Draft = { id: null, name: "", description: "", location: "", timeText: "", tltsNeeded: "0", lifeguardsNeeded: "0", helpersNeeded: "0" };
type NeededField = "tltsNeeded" | "lifeguardsNeeded" | "helpersNeeded";
const neededLabels: Record<NeededField, string> = { tltsNeeded: "TLTs needed", lifeguardsNeeded: "Lifeguards needed", helpersNeeded: "Other adult helpers needed" };

type AssignDraft = { activityId: string; role: (typeof ASSIGNABLE_ROLES)[number]; key: string };
type Message = { tone: "success" | "error"; text: string };

/**
 * The event staffing sheet (#1678): the activities, who leads each, which people help, the gaps, and the print and CSV buttons.
 * Names show only to people who may already see the sheet (the page is not rendered for anyone else). The server decides who may
 * change anything and who may be put on an activity; this only shows or hides the controls. TLTs are a number needed for now.
 */
export function EventStaffingSheet({ endpoint, eventName, initialActivities, people, pickerTruncated, canEdit }: {
  /** The staffing route for this event, without a trailing part (`.../staffing`). */
  endpoint: string;
  eventName: string;
  initialActivities: ActivityView[];
  /** Everyone who may be put on an activity. Empty for a reader who cannot change the sheet. */
  people: PickerPerson[];
  pickerTruncated: boolean;
  canEdit: boolean;
}) {
  const [activities, setActivities] = useState(initialActivities);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [assigning, setAssigning] = useState<AssignDraft | null>(null);
  const [confirmingActivity, setConfirmingActivity] = useState<ActivityView | null>(null);
  const [confirmingPerson, setConfirmingPerson] = useState<{ activity: ActivityView; person: AssignmentView } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<NeededField | "name", string>>>({});
  const [dialogError, setDialogError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [assignMessage, setAssignMessage] = useState<Message | null>(null);
  // The result of adding or removing a person, shown on the activity it belongs to.
  const [activityNotice, setActivityNotice] = useState<(Message & { activityId: string }) | null>(null);
  const [printMode, setPrintMode] = useState<"list" | "activities">("list");
  const formId = useId();
  useUnsavedChangesGuard((draft !== null && JSON.stringify(draft) !== baseline) || Boolean(assigning?.key));
  const summary = useMemo(() => summarizeStaffing(activities), [activities]);

  // Back to the full list once the print dialog closes, so the page never stays in the one-sheet-per-activity layout.
  useEffect(() => {
    const reset = () => setPrintMode("list");
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  function print(mode: "list" | "activities") {
    flushSync(() => setPrintMode(mode));
    window.print();
  }

  function startEdit(activity: ActivityView | null) {
    setMessage(null);
    setFieldErrors({});
    const next: Draft = activity
      ? { id: activity.id, name: activity.name, description: activity.description, location: activity.location, timeText: activity.timeText, tltsNeeded: String(activity.tltsNeeded), lifeguardsNeeded: String(activity.lifeguardsNeeded), helpersNeeded: String(activity.helpersNeeded) }
      : { ...blankDraft };
    setBaseline(JSON.stringify(next));
    setDraft(next);
  }

  function setProblem(text: string, where: "form" | "assign") {
    if (confirmingActivity || confirmingPerson) setDialogError(text);
    else if (where === "assign") setAssignMessage({ tone: "error", text });
    else setMessage({ tone: "error", text });
  }

  async function request<T extends object>(path: string, method: "POST" | "PATCH" | "DELETE", body: object, where: "form" | "assign"): Promise<T | null> {
    setBusy(true);
    setMessage(null);
    setAssignMessage(null);
    setActivityNotice(null);
    try {
      const response = await fetch(`${endpoint}/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as T & { message?: string };
      if (!response.ok) {
        setProblem(notSavedMessage(result.message ?? "Try again."), where);
        return null;
      }
      return result;
    } catch {
      setProblem(notSavedMessage("Check your connection and try again."), where);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const replaceActivity = (saved: ActivityView) => setActivities((current) => current.map((activity) => (activity.id === saved.id ? saved : activity)));

  async function saveActivity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const found: Partial<Record<NeededField | "name", string>> = {};
    if (!draft.name.trim()) found.name = "Enter the activity's name.";
    const numbers = {} as Record<NeededField, number>;
    for (const field of Object.keys(neededLabels) as NeededField[]) {
      const text = draft[field].trim();
      const value = text === "" ? 0 : Number(text);
      if (!Number.isInteger(value) || value < 0 || value > MAX_NEEDED) found[field] = `${neededLabels[field]} must be a whole number from 0 to ${MAX_NEEDED}.`;
      numbers[field] = value;
    }
    setFieldErrors(found);
    const firstProblem = found.name ?? found.tltsNeeded ?? found.lifeguardsNeeded ?? found.helpersNeeded;
    if (firstProblem) {
      setMessage({ tone: "error", text: notSavedMessage(firstProblem) });
      return;
    }
    const body = { name: draft.name.trim(), description: draft.description.trim(), location: draft.location.trim(), timeText: draft.timeText.trim(), ...numbers };
    const result = await request<{ activity?: ActivityView }>("activities", draft.id ? "PATCH" : "POST", draft.id ? { id: draft.id, ...body } : body, "form");
    if (!result?.activity) return;
    const saved = result.activity;
    setActivities((current) => (draft.id ? current.map((activity) => (activity.id === saved.id ? saved : activity)) : [...current, saved]));
    setBaseline("");
    setDraft(null);
    setMessage({ tone: "success", text: savedMessage(draft.id ? "Activity updated." : "Activity added.") });
  }

  async function removeActivity(id: string) {
    const result = await request<{ ok?: boolean }>("activities", "DELETE", { id }, "form");
    if (!result) return;
    setActivities((current) => current.filter((activity) => activity.id !== id));
    setConfirmingActivity(null);
    setDialogError("");
    setMessage({ tone: "success", text: savedMessage("Activity deleted.") });
  }

  async function addPerson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assigning) return;
    const picked = people.find((person) => person.key === assigning.key);
    if (!picked) {
      setAssignMessage({ tone: "error", text: notSavedMessage("Choose a person from the list.") });
      return;
    }
    const result = await request<{ activity?: ActivityView }>("assignments", "POST", { activityId: assigning.activityId, role: assigning.role, assignee: { kind: picked.kind, id: picked.id } }, "assign");
    if (!result?.activity) return;
    replaceActivity(result.activity);
    setAssigning(null);
    setActivityNotice({ activityId: result.activity.id, tone: "success", text: savedMessage(assigning.role === "LEAD" ? "Lead set." : "Person added.") });
  }

  async function removePerson(person: AssignmentView) {
    const result = await request<{ activity?: ActivityView }>("assignments", "DELETE", { id: person.id }, "assign");
    if (!result?.activity) return;
    replaceActivity(result.activity);
    setConfirmingPerson(null);
    setDialogError("");
    setActivityNotice({ activityId: result.activity.id, tone: "success", text: savedMessage("Person removed.") });
  }

  const roleName = (role: StaffingRole) => ROLE_LABELS[role];

  return (
    <div className={styles.sheet} data-print={printMode} data-testid="staffing-sheet">
      <h2 className={styles.printTitle}>Event staffing: {eventName}</h2>
      <div className={`${styles.toolbar} ${styles.noPrint}`}>
        <button className="secondary-button report-print-button" onClick={() => print("list")} type="button"><Printer aria-hidden="true" size={15} />Print full list</button>
        <button className="secondary-button report-print-button" onClick={() => print("activities")} type="button"><Printer aria-hidden="true" size={15} />Print one sheet per activity</button>
        <a className="secondary-button" download href={`${endpoint}/export`}><Download aria-hidden="true" size={15} />Download CSV</a>
      </div>

      <section className={`${styles.block} ${styles.printHideInSheets}`} aria-labelledby={`${formId}-gaps`}>
        <h3 className={styles.heading} id={`${formId}-gaps`}>Gaps</h3>
        {activities.length === 0 ? <p className={styles.empty}>No activities yet.</p> : summary.gaps.length === 0 ? (
          <p className={styles.noGaps}>Every activity has a lead and all the people it needs.</p>
        ) : (
          <>
            <p className={styles.note}>{summary.activitiesWithGaps} of {summary.activityCount} {summary.activityCount === 1 ? "activity needs" : "activities need"} people.</p>
            <ul className={styles.gaps}>{summary.gaps.map((gap) => <li className={styles.gap} key={`${gap.activityId}-${gap.role}`}>{gap.text}</li>)}</ul>
          </>
        )}
      </section>

      <section className={styles.block} aria-labelledby={`${formId}-activities`}>
        <h3 className={styles.heading} id={`${formId}-activities`}>Activities</h3>
        {activities.length === 0 ? <p className={styles.empty}>{canEdit ? "Add the first activity below." : "Nobody has added an activity yet."}</p> : (
          <ul className={styles.activities}>
            {activities.map((activity) => {
              const gaps = activityGaps(activity);
              const counts = roleCounts(activity);
              const free = people.filter((person) => !activity.assignments.some((assignment) => assignment.kind === person.kind && assignment.assigneeId === person.id));
              const detail = [activity.timeText, activity.location].filter(Boolean).join(" · ");
              return (
                <li className={styles.activity} key={activity.id}>
                  <h4 className={styles.activityName}>{activity.name}</h4>
                  {detail && <p className={styles.details}>{detail}</p>}
                  {activity.description && <p className={styles.details}>{activity.description}</p>}
                  {counts.length > 0 && (
                    <p className={styles.counts}>
                      {counts.map((row) => <span key={row.role}>{roleName(row.role)}s: {row.assigned} of {row.needed}</span>)}
                    </p>
                  )}
                  {gaps.map((gap) => <p className={styles.gap} key={gap.role}>Needs: {gap.shortText}</p>)}
                  {activity.assignments.length > 0 && (
                    <ul className={styles.people}>
                      {activity.assignments.map((person) => (
                        <li className={styles.person} key={person.id}>
                          <span><span className={styles.personName}>{person.name}</span> <span className={styles.role}>({roleName(person.role)}{person.active ? "" : ", no longer on the event"})</span></span>
                          {canEdit && (
                            <button className={`secondary-button ${styles.removeButton} ${styles.noPrint}`} disabled={busy} onClick={() => { setDialogError(""); setConfirmingPerson({ activity, person }); }} type="button">
                              Remove<span className="sr-only">: {person.name} from {activity.name}</span>
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canEdit && (
                    <div className={`${styles.actions} ${styles.noPrint}`}>
                      <button className="secondary-button" disabled={busy} onClick={() => { setAssignMessage(null); setAssigning({ activityId: activity.id, role: activity.assignments.some((assignment) => assignment.role === "LEAD") ? "HELPER" : "LEAD", key: "" }); }} type="button">Add a person<span className="sr-only">: {activity.name}</span></button>
                      <button className="secondary-button" disabled={busy} onClick={() => startEdit(activity)} type="button">Edit<span className="sr-only">: {activity.name}</span></button>
                      <button className="secondary-button" disabled={busy} onClick={() => { setDialogError(""); setConfirmingActivity(activity); }} type="button">Delete<span className="sr-only">: {activity.name}</span></button>
                    </div>
                  )}
                  {activityNotice?.activityId === activity.id && assigning?.activityId !== activity.id && <div className={styles.noPrint}><FormMessage message={activityNotice.text} tone={activityNotice.tone} /></div>}
                  {canEdit && assigning?.activityId === activity.id && (
                    <form noValidate className={`${styles.form} ${styles.noPrint}`} onSubmit={(event) => void addPerson(event)} aria-labelledby={`${formId}-assign-title`}>
                      <h5 className={styles.heading} id={`${formId}-assign-title`}>Add a person to {activity.name}</h5>
                      <div className={styles.fields}>
                        <label className={styles.field}>Role
                          <select value={assigning.role} onChange={(event) => setAssigning({ ...assigning, role: event.target.value as AssignDraft["role"], key: assigning.key.startsWith("account:") && event.target.value !== "LEAD" ? "" : assigning.key })}>
                            {ASSIGNABLE_ROLES.map((role) => <option key={role} value={role}>{roleName(role)}</option>)}
                          </select>
                          {assigning.role === "LEAD" && <span className={styles.help}>A new lead replaces the current lead.</span>}
                        </label>
                        <label className={styles.field}>Person
                          <select value={assigning.key} onChange={(event) => setAssigning({ ...assigning, key: event.target.value })}>
                            <option value="">Choose a person</option>
                            {free.filter((person) => person.kind !== "account").map((person) => <option key={person.key} value={person.key}>{person.name} ({person.detail})</option>)}
                            {assigning.role === "LEAD" && free.some((person) => person.kind === "account") && (
                              <optgroup label="Area Coordinators">
                                {free.filter((person) => person.kind === "account").map((person) => <option key={person.key} value={person.key}>{person.name}</option>)}
                              </optgroup>
                            )}
                          </select>
                          <span className={styles.help}>People registered for this event and its staff; Area Coordinators can be chosen as the lead. TLTs are counted as a number needed for now.</span>
                          {pickerTruncated && <span className={styles.help}>This event has more people than fit in this list.</span>}
                        </label>
                      </div>
                      <div className={styles.toolbar}>
                        <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving…" : "Add"}</button>
                        <button className="secondary-button" disabled={busy} onClick={() => setAssigning(null)} type="button">Cancel</button>
                      </div>
                      {assignMessage && <FormMessage message={assignMessage.text} tone={assignMessage.tone} />}
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canEdit && !draft && (
          <div className={styles.noPrint}>
            <button className="secondary-button" disabled={busy} onClick={() => startEdit(null)} type="button">Add an activity</button>
          </div>
        )}
        {canEdit && draft && (
          <form noValidate className={`${styles.form} ${styles.noPrint}`} onSubmit={(event) => void saveActivity(event)} aria-labelledby={`${formId}-title`}>
            <h4 className={styles.heading} id={`${formId}-title`}>{draft.id ? "Change this activity" : "Add an activity"}</h4>
            <div className={styles.fields}>
              <label className={styles.field}>Name
                <input {...fieldErrorProps(`${formId}-name-error`, fieldErrors.name)} maxLength={MAX_NAME_LENGTH} required value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setFieldErrors((current) => ({ ...current, name: undefined })); }} />
                <FieldError id={`${formId}-name-error`}>{fieldErrors.name}</FieldError>
              </label>
              <label className={styles.field}>When (optional)
                <input maxLength={MAX_TEXT_LENGTH} value={draft.timeText} onChange={(event) => setDraft({ ...draft, timeText: event.target.value })} />
              </label>
              <label className={styles.field}>Where (optional)
                <input maxLength={MAX_TEXT_LENGTH} value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} />
              </label>
              <label className={styles.field}>Description (optional)
                <input maxLength={MAX_TEXT_LENGTH} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </label>
              {(Object.keys(neededLabels) as NeededField[]).map((field) => (
                <label className={styles.field} key={field}>{neededLabels[field]}
                  <input {...fieldErrorProps(`${formId}-${field}-error`, fieldErrors[field])} inputMode="numeric" value={draft[field]} onChange={(event) => { setDraft({ ...draft, [field]: event.target.value }); setFieldErrors((current) => ({ ...current, [field]: undefined })); }} />
                  <FieldError id={`${formId}-${field}-error`}>{fieldErrors[field]}</FieldError>
                </label>
              ))}
            </div>
            <div className={styles.toolbar}>
              <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save activity"}</button>
              <button className="secondary-button" disabled={busy} onClick={() => { setBaseline(""); setDraft(null); }} type="button">Cancel</button>
            </div>
            {message && <FormMessage message={message.text} tone={message.tone} />}
          </form>
        )}
        {!canEdit && <p className={`${styles.note} ${styles.noPrint}`}>You can read this sheet. Event administrators and Area Coordinators change it.</p>}
        {message && !draft && <div className={styles.noPrint}><FormMessage message={message.text} tone={message.tone} /></div>}
      </section>

      <ConfirmDialog
        busy={busy}
        busyLabel="Deleting…"
        confirmLabel="Delete activity"
        destructive
        error={dialogError}
        onCancel={() => { setConfirmingActivity(null); setDialogError(""); }}
        onConfirm={() => { if (confirmingActivity) void removeActivity(confirmingActivity.id); }}
        open={confirmingActivity !== null}
        title="Delete this activity?"
      >
        {confirmingActivity && <p>{confirmingActivity.name}{confirmingActivity.assignments.length > 0 ? `, and the ${confirmingActivity.assignments.length} ${confirmingActivity.assignments.length === 1 ? "person" : "people"} on it, come` : " comes"} off the sheet. This cannot be undone.</p>}
      </ConfirmDialog>
      <ConfirmDialog
        busy={busy}
        busyLabel="Removing…"
        confirmLabel="Remove person"
        destructive
        error={dialogError}
        onCancel={() => { setConfirmingPerson(null); setDialogError(""); }}
        onConfirm={() => { if (confirmingPerson) void removePerson(confirmingPerson.person); }}
        open={confirmingPerson !== null}
        title="Take this person off the activity?"
      >
        {confirmingPerson && <p>{confirmingPerson.person.name} ({roleName(confirmingPerson.person.role)}) comes off {confirmingPerson.activity.name}. You can add them again.</p>}
      </ConfirmDialog>
    </div>
  );
}
