"use client";

import { useEffect, useState } from "react";
import { Send, X } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDateRange } from "@/modules/calendar/domain";
import type { PendingReminderBatch, PendingReminders } from "@/modules/calendar/deadline-reminders";

type ApiResult = Partial<PendingReminders> & {
  message?: string;
  sent?: number;
  optedOut?: number;
  reminders?: PendingReminders;
};

/**
 * Deadline reminders waiting for staff (#910). Each batch was prepared
 * automatically, 14 or 2 days before a deadline, and is emailed only when a
 * system administrator sends it here: the preview shows exactly what it says
 * and how many people it reaches, and Send is the one action.
 */
export function DeadlineRemindersPanel({ initial, onCountChange }: { initial: PendingReminders; onCountChange?: (count: number) => void }) {
  const [state, setState] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dismissTarget, setDismissTarget] = useState<PendingReminderBatch | null>(null);

  // The tab's badge follows the list as batches are sent or set aside.
  useEffect(() => { onCountChange?.(state.batches.length); }, [onCountChange, state.batches.length]);

  async function refresh() {
    const response = await fetch("/api/admin/calendar/deadline-reminders");
    const result = await response.json().catch(() => ({})) as ApiResult;
    if (response.ok && result.batches) setState({ batches: result.batches, emailConfigured: result.emailConfigured ?? false, repeatingDeadlines: result.repeatingDeadlines ?? 0 });
  }

  async function act(batch: PendingReminderBatch, body: { action: "send"; fingerprint: string } | { action: "dismiss" }) {
    setBusyId(batch.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/calendar/deadline-reminders/${encodeURIComponent(batch.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as ApiResult;
      if (!response.ok) {
        setError(result.message ?? "The reminder could not be updated.");
        await refresh(); // a changed deadline shows its new wording and recipients
        return;
      }
      if (result.reminders) setState(result.reminders);
      setNotice(body.action === "send"
        ? `Sent "${batch.title}" to ${result.sent ?? 0} ${result.sent === 1 ? "person" : "people"}.`
        : `Won't send the reminder for "${batch.title}".`);
    } catch {
      setError("The reminder could not be updated. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel form-stack deadline-reminders" aria-labelledby="deadline-reminders-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Clubs and Area Coordinators</p>
          <h2 id="deadline-reminders-heading">Deadline reminders</h2>
        </div>
      </div>
      <p className="field-help">
        Two weeks and two days before each deadline, a reminder is prepared for every club director and Area Coordinator.
        Nothing is emailed until you send it here. If a deadline changes or is cancelled first, its reminder follows or is withdrawn.
      </p>
      {!state.emailConfigured && (
        <div className="inline-notice error" role="alert">Account email isn&apos;t set up on this server, so reminders can&apos;t be sent yet.</div>
      )}
      {state.repeatingDeadlines > 0 && (
        <div className="inline-notice" role="note">
          Repeating deadlines are listed for clubs but don&apos;t get reminder emails.
          {" "}{state.repeatingDeadlines === 1 ? "One deadline repeats." : `${state.repeatingDeadlines} deadlines repeat.`}
        </div>
      )}
      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {state.batches.length === 0 ? (
        <div className="empty-state"><h3>Nothing waiting</h3><p>No reminders are waiting to be sent.</p></div>
      ) : (
        <ul className="calendar-admin-list">
          {state.batches.map((batch) => {
            const busy = busyId === batch.id;
            return (
              <li className="calendar-entry-row deadline-reminder-row" key={batch.id}>
                <div className="calendar-entry-text">
                  <strong>{batch.title}</strong>
                  <small>
                    Due {formatDateRange(batch.dueOn, batch.dueOn)} · {batch.dueLabel} · {batch.daysBefore}-day reminder
                  </small>
                  <span className="calendar-admin-chips">
                    <span className="status-chip gold">Waiting for you</span>
                    <span className="status-chip">{batch.recipientCount} {batch.recipientCount === 1 ? "person" : "people"}</span>
                    <span className="status-chip neutral">{batch.clubRecipients} club, {batch.areaRecipients} area</span>
                    {batch.optedOutCount > 0 && <span className="status-chip neutral">{batch.optedOutCount} opted out</span>}
                  </span>
                  <details>
                    <summary>Preview the email</summary>
                    <p><strong>Subject:</strong> {batch.subject}</p>
                    <p className="field-help">Club directors and other club roles ({batch.clubRecipients}) read:</p>
                    <pre className="deadline-reminder-preview">{batch.bodyText}</pre>
                    <p className="field-help">Area Coordinators ({batch.areaRecipients}) read:</p>
                    <pre className="deadline-reminder-preview">{batch.areaBodyText}</pre>
                  </details>
                </div>
                <div className="calendar-admin-actions">
                  <button
                    className="primary-button"
                    disabled={busy || !state.emailConfigured || batch.recipientCount === 0}
                    onClick={() => void act(batch, { action: "send", fingerprint: batch.fingerprint })}
                    type="button"
                  >
                    <Send aria-hidden="true" size={14} /> {busy ? "Sending…" : `Send to ${batch.recipientCount}`}
                  </button>
                  <button className="secondary-button" disabled={busy} onClick={() => { setError(""); setDismissTarget(batch); }} type="button">
                    <X aria-hidden="true" size={14} /> Don&apos;t send
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        busy={busyId !== null}
        confirmLabel="Don't send it"
        error={error}
        onCancel={() => setDismissTarget(null)}
        onConfirm={() => {
          const target = dismissTarget;
          if (!target) return;
          void act(target, { action: "dismiss" }).then(() => setDismissTarget(null));
        }}
        open={dismissTarget !== null}
        title={dismissTarget ? `Don't send the ${dismissTarget.daysBefore}-day reminder for "${dismissTarget.title}"?` : "Don't send?"}
      >
        <p>Nobody is emailed, and this reminder is not prepared again for this due date. If the due date moves, a new reminder is prepared for the new date.</p>
      </ConfirmDialog>
    </section>
  );
}
