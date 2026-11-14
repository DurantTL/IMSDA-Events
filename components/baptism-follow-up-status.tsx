"use client";

import { useState } from "react";
import { FormErrorSummary, summaryMessage, useFormErrorSummary } from "@/components/form-error-summary";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { BAPTISM_NOTE_MAX_LENGTH, parseFollowUpNote } from "@/modules/baptism-follow-up/domain";
import styles from "@/components/baptism-follow-up.module.css";

type Status = { followedUpAt: string | null; note: string | null };

function statusText(followedUpAt: string | null) {
  return followedUpAt ? `Followed up on ${formatInConferenceTime(new Date(followedUpAt), { dateStyle: "medium" })}` : "Not followed up yet";
}

/**
 * One name's followed-up status and note (#1680). With an `endpoint` it is a small form: a "Followed up" checkbox, an optional
 * note and one Save button, saved with PATCH `${endpoint}/${id}`. Without one it only reads. The server decides who may save.
 */
export function BaptismFollowUpStatus({ id, name, endpoint, initial }: { id: string; name: string; endpoint?: string; initial: Status }) {
  const [saved, setSaved] = useState<Status>(initial);
  const [followedUp, setFollowedUp] = useState(initial.followedUpAt !== null);
  const [note, setNote] = useState(initial.note ?? "");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();
  const noteId = `baptism-note-${id}`;
  const dirty = followedUp !== (saved.followedUpAt !== null) || note.trim() !== (saved.note ?? "");
  useUnsavedChangesGuard(dirty && !busy, "You have an unsaved baptism follow-up change. Leave this page and discard it?");

  if (!endpoint) {
    return (
      <div className={styles.status}>
        <p className={styles.statusLine}>{statusText(saved.followedUpAt)}</p>
        {saved.note && <p className={styles.noteText}>Note: {saved.note}</p>}
      </div>
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setFieldError(null);
    clearSummary();
    const parsed = parseFollowUpNote(note);
    if (!parsed.ok) {
      setFieldError(parsed.message);
      showSummary([{ targetId: noteId, message: summaryMessage("Note", parsed.message) }]);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ followedUp, note, expectedFollowedUpAt: saved.followedUpAt, expectedNote: saved.note }) });
      const result = await response.json().catch(() => ({})) as { status?: Status & { id: string }; message?: string; error?: string };
      if (!response.ok || !result.status) {
        const reason = result.message ?? "Try Save again.";
        if (result.error === "INVALID_NOTE" || result.error === "INVALID_REQUEST") {
          setFieldError(reason);
          showSummary([{ targetId: noteId, message: summaryMessage("Note", reason) }]);
        } else {
          setMessage({ tone: "error", text: notSavedMessage(reason) });
        }
        return;
      }
      const next = { followedUpAt: result.status.followedUpAt, note: result.status.note };
      setSaved(next);
      setFollowedUp(next.followedUpAt !== null);
      setNote(next.note ?? "");
      setMessage({ tone: "success", text: savedMessage() });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.status} noValidate onSubmit={save}>
      {summaryItems.length > 0 && <FormErrorSummary action="saving" items={summaryItems} ref={summaryRef} />}
      <p className={styles.statusLine}>{statusText(saved.followedUpAt)}</p>
      <label className={styles.check} htmlFor={`baptism-followed-${id}`}>
        <input checked={followedUp} disabled={busy} id={`baptism-followed-${id}`} onChange={(event) => setFollowedUp(event.target.checked)} type="checkbox" />
        <span>Followed up<span className="sr-only"> with <span translate="no">{name}</span></span></span>
      </label>
      <label className={styles.noteField} htmlFor={noteId}>
        <span>Note (optional)<span className="sr-only"> for <span translate="no">{name}</span></span></span>
        <textarea aria-describedby={fieldError ? `${noteId}-error ${noteId}-help` : `${noteId}-help`} aria-invalid={fieldError ? true : undefined} autoComplete="off" disabled={busy} id={noteId} onChange={(event) => { setNote(event.target.value); setFieldError(null); clearSummaryField(noteId); }} rows={3} value={note} />
        {fieldError && <small className="field-error-message" id={`${noteId}-error`}>{fieldError}</small>}
        <span className={styles.help} id={`${noteId}-help`}>Up to {BAPTISM_NOTE_MAX_LENGTH} characters. Kept with the name. It is not emailed.</span>
      </label>
      <div className={styles.row}>
        <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save"}<span className="sr-only"> for <span translate="no">{name}</span></span></button>
      </div>
      {message && <FormMessage message={message.text} tone={message.tone} />}
    </form>
  );
}
