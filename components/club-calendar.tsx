"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary } from "@/components/form-error-summary";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import {
  CLUB_CALENDAR_KINDS,
  CLUB_CALENDAR_LOCATION_MAX,
  CLUB_CALENDAR_NOTES_MAX,
  CLUB_CALENDAR_TITLE_MAX,
  REMINDER_DAYS_MAX,
  REMINDER_DAYS_MIN,
  clubCalendarKindLabels,
  type AgendaEntry,
} from "@/modules/club-calendar/domain";
import type { ClubCalendarView } from "@/modules/club-calendar/repository";
import styles from "./club-calendar.module.css";

/**
 * The club calendar page's body (#1700): month links, the agenda (each entry says in words whether it is the club's or the
 * conference's), and, for the director and deputy, a form to add an item, an edit and delete on each club item, and the
 * reminder setting. The routes check the role and the feature again and record every change.
 */

const monthLabel = (key: string) => new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

class RequestError extends Error {
  constructor(message: string, readonly issues: Array<{ path?: unknown[]; message?: string }> = []) {
    super(message);
  }
}

async function request(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const result = await response.json().catch(() => ({})) as { message?: string; issues?: Array<{ path?: unknown[]; message?: string }> };
  if (!response.ok) throw new RequestError(result.message ?? "That could not be saved.", result.issues);
}

type FieldKey = "kind" | "title" | "date" | "startTime" | "endTime" | "location" | "notes";
const FIELD_LABELS: Record<FieldKey, string> = { kind: "Type", title: "Title", date: "Date", startTime: "Start time", endTime: "End time", location: "Location", notes: "Notes" };
type Values = Record<FieldKey, string>;
const emptyValues = (date = ""): Values => ({ kind: "MEETING", title: "", date, startTime: "", endTime: "", location: "", notes: "" });

function ItemForm({ organizationId, entry, defaultDate, onDone }: { organizationId: string; entry?: AgendaEntry; defaultDate: string; onDone?: () => void }) {
  const router = useRouter();
  const idBase = `club-calendar-${entry?.itemId ?? "new"}`;
  const fieldId = (key: FieldKey) => `${idBase}-${key}`;
  const [values, setValues] = useState<Values>(() => entry
    ? { ...emptyValues(entry.startsOn), kind: entry.kind ?? "MEETING", title: entry.title, location: entry.location, notes: entry.notes ?? "", ...timesFrom(entry) }
    : emptyValues(defaultDate));
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const [saved, setSaved] = useState("");
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();

  function set(key: FieldKey, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    clearSummaryField(fieldId(key));
  }

  function report(found: Partial<Record<FieldKey, string>>) {
    setErrors(found);
    showSummary((Object.keys(found) as FieldKey[]).map((key) => ({ targetId: fieldId(key), message: summaryMessage(FIELD_LABELS[key], found[key]!) })));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed("");
    setSaved("");
    clearSummary();
    const found: Partial<Record<FieldKey, string>> = {};
    if (!values.title.trim()) found.title = "Enter a title.";
    if (!values.date) found.date = "Enter a date.";
    if (Object.keys(found).length > 0) {
      report(found);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const url = `/api/attendee/clubs/${encodeURIComponent(organizationId)}/calendar${entry?.itemId ? `/${encodeURIComponent(entry.itemId)}` : ""}`;
      await request(url, { method: entry ? "PATCH" : "POST", body: JSON.stringify(values) });
      if (!entry) setValues(emptyValues(defaultDate));
      setSaved(savedMessage());
      router.refresh();
      onDone?.();
    } catch (caught) {
      const mapped: Partial<Record<FieldKey, string>> = {};
      if (caught instanceof RequestError) {
        for (const issue of caught.issues) {
          const key = issue.path?.[0];
          if (typeof key === "string" && key in FIELD_LABELS && !mapped[key as FieldKey]) mapped[key as FieldKey] = issue.message ?? "Check this field.";
        }
      }
      if (Object.keys(mapped).length > 0) report(mapped);
      else setFailed(notSavedMessage(caught instanceof Error ? caught.message : "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const props = (key: FieldKey) => ({ id: fieldId(key), ...fieldErrorProps(`${fieldId(key)}-error`, errors[key]) });
  const error = (key: FieldKey) => <FieldError id={`${fieldId(key)}-error`}>{errors[key]}</FieldError>;

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      {summaryItems.length > 0 ? <FormErrorSummary items={summaryItems} ref={summaryRef} /> : null}
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor={fieldId("kind")}>Type</label>
          <select {...props("kind")} onChange={(event) => set("kind", event.target.value)} value={values.kind}>
            {CLUB_CALENDAR_KINDS.map((kind) => <option key={kind} value={kind}>{clubCalendarKindLabels[kind]}</option>)}
          </select>
          {error("kind")}
        </div>
        <div className={styles.field}>
          <label htmlFor={fieldId("date")}>Date</label>
          <input {...props("date")} onChange={(event) => set("date", event.target.value)} type="date" value={values.date} />
          {error("date")}
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor={fieldId("title")}>Title</label>
        <input {...props("title")} maxLength={CLUB_CALENDAR_TITLE_MAX} onChange={(event) => set("title", event.target.value)} value={values.title} />
        {error("title")}
      </div>
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor={fieldId("startTime")}>Start time (optional)</label>
          <input {...props("startTime")} onChange={(event) => set("startTime", event.target.value)} type="time" value={values.startTime} />
          {error("startTime")}
        </div>
        <div className={styles.field}>
          <label htmlFor={fieldId("endTime")}>End time (optional)</label>
          <input {...props("endTime")} onChange={(event) => set("endTime", event.target.value)} type="time" value={values.endTime} />
          {error("endTime")}
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor={fieldId("location")}>Location (optional)</label>
        <input {...props("location")} maxLength={CLUB_CALENDAR_LOCATION_MAX} onChange={(event) => set("location", event.target.value)} value={values.location} />
        {error("location")}
      </div>
      <div className={styles.field}>
        <label htmlFor={fieldId("notes")}>Notes (optional)</label>
        <textarea {...props("notes")} maxLength={CLUB_CALENDAR_NOTES_MAX} onChange={(event) => set("notes", event.target.value)} value={values.notes} />
        <small>Your club&apos;s leaders can see notes. They are never put in a reminder email.</small>
        {error("notes")}
      </div>
      <div>
        <SubmitButton icon={entry ? <Pencil aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />} label={entry ? "Save changes" : "Add to calendar"} submitting={busy} submittingLabel="Saving…" />
        <FormMessage message={failed || saved} tone={failed ? "error" : "success"} />
      </div>
    </form>
  );
}

/** The times come back as a label ("6:30 PM to 8:00 PM"); the form needs HH:MM, so they are read from the entry's raw fields. */
function timesFrom(entry: AgendaEntry) {
  return { startTime: entry.startTime ?? "", endTime: entry.endTime ?? "" };
}

function ClubEntryActions({ organizationId, entry }: { organizationId: string; entry: AgendaEntry }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await request(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/calendar/${encodeURIComponent(entry.itemId!)}`, { method: "DELETE" });
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      setError(notSavedMessage(caught instanceof Error ? caught.message : "That could not be removed."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={styles.actions}>
        <button aria-expanded={editing} className="secondary-button" onClick={() => setEditing((open) => !open)} type="button">
          <Pencil aria-hidden="true" size={16} /> {editing ? "Close editor" : "Edit"}<span className="sr-only">{` ${entry.title}`}</span>
        </button>
        <button className={`secondary-button ${styles.removeButton}`} onClick={() => { setError(""); setConfirming(true); }} type="button">
          <Trash2 aria-hidden="true" size={16} /> Delete<span className="sr-only">{` ${entry.title}`}</span>
        </button>
      </div>
      {editing ? <ItemForm defaultDate={entry.startsOn} entry={entry} onDone={() => setEditing(false)} organizationId={organizationId} /> : null}
      <ConfirmDialog
        busy={busy}
        busyLabel="Deleting…"
        confirmLabel="Delete item"
        destructive
        error={error}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void remove()}
        open={confirming}
        title={`Delete ${entry.title}?`}
      >
        <p>This removes the item from your club calendar. The change is recorded, but the item cannot be brought back; you would add it again.</p>
      </ConfirmDialog>
    </>
  );
}

function ReminderSettings({ organizationId, initial }: { organizationId: string; initial: { enabled: boolean; daysBefore: number } }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [days, setDays] = useState(String(initial.daysBefore));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const [saved, setSaved] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed("");
    setSaved("");
    const daysBefore = Number(days);
    if (!Number.isInteger(daysBefore) || daysBefore < REMINDER_DAYS_MIN || daysBefore > REMINDER_DAYS_MAX) {
      setFailed(notSavedMessage(`Enter a whole number of days from ${REMINDER_DAYS_MIN} to ${REMINDER_DAYS_MAX}.`));
      return;
    }
    setBusy(true);
    try {
      await request(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/calendar/reminders`, { method: "PUT", body: JSON.stringify({ enabled, daysBefore }) });
      setSaved(savedMessage());
      router.refresh();
    } catch (caught) {
      setFailed(notSavedMessage(caught instanceof Error ? caught.message : "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-labelledby="club-calendar-reminders-heading" className={styles.panel} noValidate onSubmit={(event) => void submit(event)}>
      <h3 className={styles.panelHeading} id="club-calendar-reminders-heading">Reminder emails</h3>
      <p className={styles.meta}>
        Off until you turn them on. When on, your club&apos;s director, deputy, registrar and reporter each get one email for an item,
        from 8 a.m. Central time, within the number of days you choose before it. The email names the item, date, time and place. It never includes notes.
        A person who opted out of IMAdventist announcements is skipped.
      </p>
      <label className={styles.check}>
        <input checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setSaved(""); }} type="checkbox" />
        Send reminder emails
      </label>
      <div className={styles.field}>
        <label htmlFor="club-calendar-days">Days before</label>
        <input id="club-calendar-days" inputMode="numeric" max={REMINDER_DAYS_MAX} min={REMINDER_DAYS_MIN} onChange={(event) => { setDays(event.target.value); setSaved(""); }} type="number" value={days} />
        <small>{`From ${REMINDER_DAYS_MIN} to ${REMINDER_DAYS_MAX}.`}</small>
      </div>
      <div>
        <SubmitButton label="Save reminder settings" submitting={busy} submittingLabel="Saving…" />
        <FormMessage message={failed || saved} tone={failed ? "error" : "success"} />
      </div>
    </form>
  );
}

function dateText(entry: AgendaEntry) {
  return entry.startsOn === entry.endsOn ? dayLabel(entry.startsOn) : `${dayLabel(entry.startsOn)} to ${dayLabel(entry.endsOn)}`;
}

function EntryRow({ organizationId, entry, canManage }: { organizationId: string; entry: AgendaEntry; canManage: boolean }) {
  const club = entry.source === "CLUB";
  const when = [dateText(entry), entry.timeLabel].filter(Boolean).join(", ");
  const link = entry.href
    ? (entry.href.startsWith("/")
      ? <Link className={styles.entryLink} href={entry.href}>View {entry.title}</Link>
      : <a className={styles.entryLink} href={entry.href} rel="noreferrer">View {entry.title}</a>)
    : null;
  return (
    <li className={`${styles.entry} ${club ? styles.club : styles.conference}`}>
      <p className={styles.label}>{entry.label}</p>
      <h3 className={styles.title}>{entry.title}</h3>
      <p className={styles.meta}>{when}</p>
      {entry.location ? <p className={styles.meta}>{entry.location}</p> : null}
      {entry.notes ? <p className={styles.notes}>{entry.notes}</p> : null}
      {link}
      {club && canManage ? <ClubEntryActions entry={entry} organizationId={organizationId} /> : null}
    </li>
  );
}

export function ClubCalendar({ organizationId, view }: { organizationId: string; view: ClubCalendarView }) {
  const base = `/account/clubs/${organizationId}/calendar`;
  const defaultDate = view.monthKey === view.todayMonthKey ? "" : `${view.monthKey}-01`;
  return (
    <>
      <nav aria-label="Calendar months" className={styles.nav}>
        <Link className={`secondary-button ${styles.navLink}`} href={`${base}?month=${view.previousMonthKey}`}>
          <ChevronLeft aria-hidden="true" size={16} /> {monthLabel(view.previousMonthKey)}
        </Link>
        <p aria-live="polite" className={styles.month}>{monthLabel(view.monthKey)}</p>
        <Link className={`secondary-button ${styles.navLink}`} href={`${base}?month=${view.nextMonthKey}`}>
          {monthLabel(view.nextMonthKey)} <ChevronRight aria-hidden="true" size={16} />
        </Link>
      </nav>
      {view.monthKey !== view.todayMonthKey ? <p><Link className={styles.entryLink} href={base}>Back to this month</Link></p> : null}
      {view.agenda.length === 0
        ? <p className="inline-notice">{`Nothing on the calendar for ${monthLabel(view.monthKey)}.`}{view.canManage ? " Add a meeting, outing or deadline below." : ""}</p>
        : (
          <ul aria-label={`Calendar for ${monthLabel(view.monthKey)}`} className={styles.agenda}>
            {view.agenda.map((entry) => <EntryRow canManage={view.canManage} entry={entry} key={entry.key} organizationId={organizationId} />)}
          </ul>
        )}
      {view.canManage ? (
        <details className={`${styles.panel} ${styles.add}`}>
          <summary><Plus aria-hidden="true" size={16} /> Add a meeting, outing or deadline</summary>
          <ItemForm defaultDate={defaultDate} organizationId={organizationId} />
        </details>
      ) : null}
      {view.canManage && view.reminder ? <ReminderSettings initial={view.reminder} organizationId={organizationId} /> : null}
    </>
  );
}
