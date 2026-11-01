"use client";

import { EventSetupHelp } from "@/components/event-setup-help";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Plus, RefreshCw } from "lucide-react";
import { ActionsMenu } from "@/components/actions-menu";
import { StaffPageHeader } from "@/components/staff-page-header";
import { scheduleDiscardPrompt, scheduleEditorIsDirty, scheduleEditorSnapshot } from "@/components/announcement-draft-dirty";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import {
  SCHEDULED_EMAIL_TEMPLATE_KEYS,
  SCHEDULED_EMAIL_TEMPLATE_LABELS,
  SCHEDULED_EMAIL_TRIGGERS,
  SCHEDULED_EMAIL_TRIGGER_LABELS,
  replaceApprovalReview,
  type ScheduledEmailTemplateKey,
  type ScheduledEmailTrigger,
} from "@/modules/communications/scheduled-email-options";
import type { ScheduledEmailRecord, ScheduledEmailReviewView } from "@/modules/communications/scheduled-email-repository";

/**
 * The staff page for scheduled email batches (#177). Writing a schedule and approving it are two separate steps a person
 * takes on purpose: "Save schedule" writes one that sends nothing, and only "Approve and schedule" in a schedule's review
 * makes it send at its time. The review shows the projected time in the event's zone, the daylight-saving note, how many
 * people will receive it, and who is left out and why, before either step.
 */

type Role = "REGISTRATION_CONTACT" | "ATTENDEE" | "GROUP_LEADER" | "ORGANIZATION_CONTACT";
const ROLE_OPTIONS: Array<{ role: Role; label: string }> = [
  { role: "REGISTRATION_CONTACT", label: "Registration contact" },
  { role: "ATTENDEE", label: "Adult attendees" },
  { role: "GROUP_LEADER", label: "Group billing contact" },
  { role: "ORGANIZATION_CONTACT", label: "Approved organization contact" },
];

type FormState = {
  scheduleId: string;
  editing: { id: string; revision: number } | null;
  name: string;
  templateKey: ScheduledEmailTemplateKey;
  announcementTitle: string;
  announcementBody: string;
  trigger: ScheduledEmailTrigger;
  localDate: string;
  localTime: string;
  daysBefore: string;
  roles: Role[];
  search: string;
};

type ApiResult = {
  message?: string;
  review?: ScheduledEmailReviewView;
  schedule?: ScheduledEmailRecord;
  scheduledEmails?: ScheduledEmailRecord[];
  currentFingerprint?: string;
  issues?: Array<{ message?: string }>;
};

function blankForm(): FormState {
  return {
    scheduleId: crypto.randomUUID(),
    editing: null,
    name: "",
    templateKey: "BALANCE_REMINDER",
    announcementTitle: "",
    announcementBody: "",
    trigger: "ONE_TIME",
    localDate: "",
    localTime: "09:00",
    daysBefore: "7",
    roles: ["REGISTRATION_CONTACT"],
    search: "",
  };
}

function formFromRecord(record: ScheduledEmailRecord): FormState {
  const query = (record.query ?? {}) as { roles?: Role[]; search?: string };
  return {
    scheduleId: record.id,
    editing: { id: record.id, revision: record.revision },
    name: record.name,
    templateKey: record.templateKey,
    announcementTitle: record.announcementTitle,
    announcementBody: record.announcementBody,
    trigger: record.rule.trigger,
    localDate: record.rule.trigger === "ONE_TIME" ? record.rule.localDate : "",
    localTime: record.rule.localTime,
    daysBefore: record.rule.trigger === "ONE_TIME" ? "7" : String(record.rule.daysBefore),
    roles: query.roles?.length ? query.roles : ["REGISTRATION_CONTACT"],
    search: query.search ?? "",
  };
}

function contentFrom(form: FormState) {
  return {
    name: form.name,
    templateKey: form.templateKey,
    announcementTitle: form.announcementTitle,
    announcementBody: form.announcementBody,
    rule: form.trigger === "ONE_TIME"
      ? { trigger: form.trigger, localDate: form.localDate, localTime: form.localTime }
      : { trigger: form.trigger, daysBefore: Number(form.daysBefore), localTime: form.localTime },
    query: { roles: form.roles, ...(form.search.trim() ? { search: form.search.trim() } : {}) },
  };
}

const STATUS_TONE: Record<ScheduledEmailRecord["status"], string> = {
  SCHEDULED: "gold",
  ACTIVE: "green",
  PAUSED: "gold",
  CANCELLED: "neutral",
  COMPLETED: "green",
  FAILED: "coral",
};

export function ScheduledEmailsWorkspace({
  eventId,
  eventName,
  eventTimezone,
  initialSchedules,
  openNew: startWithForm = false,
}: {
  eventId: string;
  eventName: string;
  eventTimezone: string;
  initialSchedules: ScheduledEmailRecord[];
  /** Open the new-schedule form on arrival (`?new=1`). */
  openNew?: boolean;
}) {
  const [schedules, setSchedules] = useState(initialSchedules);
  const [form, setForm] = useState<FormState | null>(() => (startWithForm ? blankForm() : null));
  const [formReview, setFormReview] = useState<ScheduledEmailReviewView | null>(null);
  const [approval, setApproval] = useState<{ schedule: ScheduledEmailRecord; review: ScheduledEmailReviewView } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The editor's loaded baseline (a blank new schedule or the saved one being edited), so unsaved edits are told apart from a clean form (#1104).
  const [baseline, setBaseline] = useState<string | null>(() => (startWithForm ? scheduleEditorSnapshot(blankForm()) : null));
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const newScheduleRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef(false);
  /** The editor is gone, so focus would fall to the page: ask for it on the stable "New schedule" button instead. */
  function focusNewSchedule() {
    pendingFocusRef.current = true;
  }
  // Focus lands only once the editor is gone and the button is enabled again (it is disabled while busy),
  // and after the confirm dialog has returned its own focus.
  useEffect(() => {
    if (!pendingFocusRef.current || form || busy) return;
    pendingFocusRef.current = false;
    newScheduleRef.current?.focus();
  }, [form, busy]);
  const dirty = Boolean(form) && scheduleEditorIsDirty(baseline, form!);
  useUnsavedChangesGuard(dirty, "This schedule has unsaved edits. Nothing was saved, approved or sent. Leave and discard them?");

  const base = `/api/events/${eventId}/scheduled-emails`;
  const content = useMemo(() => (form ? contentFrom(form) : null), [form]);

  async function call(url: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as ApiResult;
      if (!response.ok) {
        // A review that moved is shown again, so the person approves what is true now, not what they read earlier.
        const moved = result.review;
        if (moved) {
          setFormReview(moved);
          // The approval panel shows the changed review too, so the approver sees what is true now before approving again.
          setApproval((current) => replaceApprovalReview(current, moved));
        }
        throw new Error(result.message ?? result.issues?.[0]?.message ?? "The request could not be completed.");
      }
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request could not be completed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(base, { cache: "no-store" });
      const result = await response.json().catch(() => ({})) as ApiResult;
      if (!response.ok || !result.scheduledEmails) throw new Error(result.message ?? "The schedules could not be loaded.");
      setSchedules(result.scheduledEmails);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The schedules could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  function replace(next: ScheduledEmailRecord) {
    setSchedules((current) => current.some((entry) => entry.id === next.id)
      ? current.map((entry) => (entry.id === next.id ? next : entry))
      : [next, ...current]);
  }

  /** True when the editor may be replaced or closed: it is clean, or the person chose Discard changes. */
  async function confirmLeaveEditor() {
    if (!dirty) return true;
    return askConfirm({ ...scheduleDiscardPrompt, body: <p>{scheduleDiscardPrompt.body}</p> });
  }

  function loadEditor(next: FormState | null) {
    setForm(next);
    setBaseline(next ? scheduleEditorSnapshot(next) : null);
    setFormReview(null);
  }

  async function openNew() {
    if (!(await confirmLeaveEditor())) return;
    setError("");
    setNotice("");
    setApproval(null);
    loadEditor(blankForm());
  }

  async function edit(record: ScheduledEmailRecord) {
    if (!(await confirmLeaveEditor())) return;
    setError("");
    setNotice("");
    setApproval(null);
    loadEditor(formFromRecord(record));
  }

  async function cancelEditor() {
    if (!(await confirmLeaveEditor())) return;
    loadEditor(null);
    focusNewSchedule();
  }

  function change<K extends keyof FormState>(key: K, value: FormState[K]) {
    // Any change makes the review that was shown stale, so it cannot be saved against the new wording.
    setFormReview(null);
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function toggleRole(role: Role) {
    if (!form) return;
    const next = form.roles.includes(role) ? form.roles.filter((value) => value !== role) : [...form.roles, role];
    change("roles", next.length ? next : form.roles);
  }

  async function review() {
    if (!content) return;
    const result = await call(base, { action: "preview", ...content });
    if (result?.review) setFormReview(result.review);
  }

  async function save() {
    if (!form || !content || !formReview) return;
    const result = form.editing
      ? await call(base, { action: "update", scheduleId: form.editing.id, expectedRevision: form.editing.revision, previewFingerprint: formReview.reviewFingerprint, ...content })
      : await call(base, { action: "create", scheduleId: form.scheduleId, previewFingerprint: formReview.reviewFingerprint, ...content });
    if (!result?.schedule) return;
    replace(result.schedule);
    loadEditor(null);
    focusNewSchedule();
    setNotice(`${result.schedule.name} was saved. Nothing will be sent until you review and approve it.`);
  }

  async function openApproval(schedule: ScheduledEmailRecord) {
    if (!(await confirmLeaveEditor())) return;
    setError("");
    setNotice("");
    loadEditor(null);
    const result = await call(`${base}/${schedule.id}`, { action: "review" });
    if (result?.review) setApproval({ schedule, review: result.review });
  }

  async function approve() {
    if (!approval) return;
    const result = await call(`${base}/${approval.schedule.id}`, {
      action: "activate",
      expectedRevision: approval.schedule.revision,
      previewFingerprint: approval.review.reviewFingerprint,
    });
    if (!result?.schedule) return;
    replace(result.schedule);
    setApproval(null);
    setNotice(`${result.schedule.name} is approved. It will be sent at ${result.schedule.sendAtLabel}.`);
  }

  async function act(schedule: ScheduledEmailRecord, action: "pause" | "cancel") {
    const result = await call(`${base}/${schedule.id}`, { action });
    if (!result?.schedule) return;
    replace(result.schedule);
    setNotice(action === "pause" ? `${schedule.name} is paused. Nothing will be sent until it is approved again.` : `${schedule.name} was cancelled.`);
  }

  return (
    <section className="page-stack scheduled-emails-workspace">
      {confirmDialog}
      <StaffPageHeader
        description={`Emails that go out later, at a time in ${eventName}'s own time zone (${eventTimezone}). Nothing is sent until a person approves it.`}
        primary={(
          <button className="primary-button" type="button" ref={newScheduleRef} onClick={() => void openNew()} disabled={busy}>
            <Plus aria-hidden="true" size={17} /> New schedule
          </button>
        )}
        actions={(
          <li>
            <button type="button" onClick={() => void reload()} disabled={busy}>
              <RefreshCw aria-hidden="true" size={16} /> Refresh list
            </button>
          </li>
        )}
      />

      {error && <div className="inline-notice error" role="alert"><AlertTriangle size={17} aria-hidden="true" /> {error}</div>}
      {notice && <div className="inline-notice success" role="status"><CheckCircle2 size={17} aria-hidden="true" /> {notice}</div>}

      {form && (
        <section className="panel" aria-label={form.editing ? "Edit schedule" : "New schedule"}>
          <div className="form-stack">
            <label>
              Name
              <input value={form.name} maxLength={120} onChange={(event) => change("name", event.target.value)} />
            </label>
            <label>
              Message
              <select value={form.templateKey} onChange={(event) => change("templateKey", event.target.value as ScheduledEmailTemplateKey)}>
                {SCHEDULED_EMAIL_TEMPLATE_KEYS.map((key) => <option key={key} value={key}>{SCHEDULED_EMAIL_TEMPLATE_LABELS[key]}</option>)}
              </select>
            </label>
            {form.templateKey === "EVENT_ANNOUNCEMENT" && (
              <>
                <label>
                  Announcement title
                  <input value={form.announcementTitle} maxLength={120} onChange={(event) => change("announcementTitle", event.target.value)} />
                </label>
                <label>
                  Announcement message
                  <textarea rows={5} value={form.announcementBody} maxLength={4000} onChange={(event) => change("announcementBody", event.target.value)} />
                </label>
              </>
            )}
            <label>
              When it is sent
              <select value={form.trigger} onChange={(event) => change("trigger", event.target.value as ScheduledEmailTrigger)}>
                {SCHEDULED_EMAIL_TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{SCHEDULED_EMAIL_TRIGGER_LABELS[trigger]}</option>)}
              </select>
            </label>
            {form.trigger === "ONE_TIME" ? (
              <label>
                Date
                <input type="date" value={form.localDate} onChange={(event) => change("localDate", event.target.value)} />
              </label>
            ) : (
              <label>
                Days before
                <input type="number" min={0} max={365} value={form.daysBefore} onChange={(event) => change("daysBefore", event.target.value)} />
              </label>
            )}
            {form.trigger === "BEFORE_PAYMENT_DUE" && (
              <p className="field-help">Counts back from the event&apos;s payment due date (set in Event settings). Goes only to registrations that still owe a balance when it sends. Changing or clearing the due date pauses this schedule for a new review.</p>
            )}
            <label>
              Time of day
              <input type="time" value={form.localTime} onChange={(event) => change("localTime", event.target.value)} />
            </label>
            <p className="field-help">Times are in the event&apos;s time zone, {eventTimezone}. Youth are never sent these emails.</p>
            <fieldset className="scheduled-email-roles">
              <legend>Who receives it</legend>
              {ROLE_OPTIONS.map(({ role, label }) => (
                <label key={role}>
                  <input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggleRole(role)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <label>
              Narrow the audience (optional)
              <input value={form.search} maxLength={4000} onChange={(event) => change("search", event.target.value)} />
              <small>The same search the People lists use, for example status=CONFIRMED&amp;payment=UNPAID.</small>
            </label>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => void review()} disabled={busy}>
                <CalendarClock aria-hidden="true" size={16} /> Review schedule
              </button>
              <button className="text-button" type="button" onClick={() => void cancelEditor()} disabled={busy}>Cancel</button>
            </div>
          </div>
          {formReview && (
            <ReviewPanel
              review={formReview}
              eventId={eventId}
              action={(
                <button className="primary-button" type="button" onClick={() => void save()} disabled={busy || formReview.eligibleCount === 0}>
                  {form.editing ? "Save changes" : "Save schedule"}
                </button>
              )}
              note="Saving does not send anything and does not approve it. You approve it from the list."
            />
          )}
        </section>
      )}

      {approval && (
        <section className="panel" aria-label={`Approve ${approval.schedule.name}`}>
          <h2>Approve {approval.schedule.name}</h2>
          <ReviewPanel
            review={approval.review}
            eventId={eventId}
            action={(
              <button className="primary-button" type="button" onClick={() => void approve()} disabled={busy || approval.review.eligibleCount === 0}>
                Approve and schedule
              </button>
            )}
            secondary={<button className="text-button" type="button" onClick={() => setApproval(null)} disabled={busy}>Not now</button>}
            note="Approving lets the system send this email at the time above. You can pause or cancel it until it starts sending."
          />
        </section>
      )}

      {schedules.length === 0 && !form ? (
        <div className="empty-state">
          <CalendarClock aria-hidden="true" size={22} />
          <p>No emails are scheduled for this event.</p>
          <EventSetupHelp context="scheduled emails" id="scheduled-emails-none" />
        </div>
      ) : (
        <ul className="scheduled-email-list">
          {schedules.map((schedule) => {
            const canApprove = schedule.status === "SCHEDULED" || schedule.status === "PAUSED" || (schedule.status === "ACTIVE" && schedule.timingStale && !schedule.claimed);
            const canEdit = (schedule.status === "SCHEDULED" || schedule.status === "PAUSED" || schedule.status === "ACTIVE") && !schedule.claimed;
            const canPause = schedule.status === "ACTIVE" && !schedule.claimed;
            const canCancel = schedule.status === "SCHEDULED" || schedule.status === "PAUSED" || schedule.status === "ACTIVE";
            return (
              <li className="panel scheduled-email-card" key={schedule.id}>
                <div className="scheduled-email-head">
                  <h3>{schedule.name}</h3>
                  <span className={`status-chip ${STATUS_TONE[schedule.status]}`}>{schedule.statusLabel}</span>
                </div>
                <dl className="scheduled-email-meta">
                  <div><dt>Message</dt><dd>{schedule.templateLabel}</dd></div>
                  <div><dt>Sends</dt><dd>{schedule.sendAtLabel}</dd></div>
                  <div><dt>Recipients</dt><dd>{schedule.eligibleCount} approved, {schedule.excludedCount} left out</dd></div>
                  {schedule.recipientCounts.QUEUED + schedule.recipientCounts.EXCLUDED + schedule.recipientCounts.CANCELLED > 0 && (
                    <div>
                      <dt>Progress</dt>
                      <dd>
                        {schedule.recipientCounts.QUEUED} queued
                        {schedule.deliveryCounts.SENT ? `, ${schedule.deliveryCounts.SENT} sent` : ""}
                        {schedule.deliveryCounts.CAPTURED ? `, ${schedule.deliveryCounts.CAPTURED} captured` : ""}
                        {schedule.recipientCounts.EXCLUDED ? `, ${schedule.recipientCounts.EXCLUDED} dropped before sending` : ""}
                        {schedule.recipientCounts.CANCELLED ? `, ${schedule.recipientCounts.CANCELLED} cancelled` : ""}
                      </dd>
                    </div>
                  )}
                </dl>
                {schedule.dstNote && schedule.dstBehavior !== "NONE" && <p className="field-help">{schedule.dstNote}</p>}
                {schedule.timingStale && schedule.status !== "COMPLETED" && (
                  <p className="inline-notice warning" role="status">
                    <AlertTriangle size={16} aria-hidden="true" /> The event&apos;s time zone or dates changed since this was reviewed. Review the new time and approve it again before it can send.
                  </p>
                )}
                {schedule.pauseReason && schedule.status === "PAUSED" && <p className="field-help">{schedule.pauseReason}</p>}
                {schedule.failureReason && schedule.status === "FAILED" && <p className="field-help">{schedule.failureReason}</p>}
                {schedule.exclusions.length > 0 && (
                  <p className="field-help">Dropped when it was sent: {schedule.exclusions.map((entry) => `${entry.label} (${entry.count})`).join("; ")}.</p>
                )}
                {(canApprove || canEdit || canPause || canCancel) && (
                  <div className="scheduled-email-actions">
                    {canApprove && (
                      <button className="secondary-button" type="button" onClick={() => void openApproval(schedule)} disabled={busy}>
                        {schedule.status === "PAUSED" ? "Review and approve again" : schedule.status === "ACTIVE" ? "Review the new time" : "Review and approve"}
                      </button>
                    )}
                    <ActionsMenu label="More" ariaLabel={`More actions for ${schedule.name}`}>
                      {canEdit && <li><button type="button" disabled={busy} onClick={() => void edit(schedule)}>Edit schedule</button></li>}
                      {canPause && <li><button type="button" disabled={busy} onClick={() => void act(schedule, "pause")}>Pause</button></li>}
                      {canCancel && (
                        <li className="actions-menu-divider">
                          <button className="actions-menu-danger" type="button" disabled={busy} onClick={() => void act(schedule, "cancel")}>
                            {schedule.claimed ? "Cancel the rest" : "Cancel schedule"}
                          </button>
                        </li>
                      )}
                    </ActionsMenu>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Left out because the age is not known: the fix is the event's attendee types. */
const ageUnknownCodes: ReadonlySet<string> = new Set(["AGE_UNKNOWN_RECIPIENT", "AGE_UNKNOWN_NO_RANGE"]);

function ReviewPanel({
  review,
  eventId,
  action,
  secondary,
  note,
}: {
  review: ScheduledEmailReviewView;
  eventId: string;
  action: React.ReactNode;
  secondary?: React.ReactNode;
  note: string;
}) {
  return (
    <div className="scheduled-email-review" role="region" aria-label="Schedule review">
      <dl className="scheduled-email-meta">
        <div><dt>Sends</dt><dd>{review.projection.sendAtLabel}</dd></div>
        <div><dt>Event time zone</dt><dd>{review.projection.eventTimezone}</dd></div>
        <div><dt>Message</dt><dd>{review.template.label}{review.template.versionNumber ? `, version ${review.template.versionNumber}` : ""}{review.template.enabled ? "" : " (turned off, so it will be held)"}</dd></div>
        <div><dt>Delivery</dt><dd>{review.deliveryMode === "EXTERNAL_EMAIL" ? "Real email" : review.deliveryMode === "LOCAL_CAPTURE" ? "Captured locally, no email is sent" : "Disabled for this event"}</dd></div>
        <div><dt>Will receive it</dt><dd>{review.eligibleCount} {review.eligibleCount === 1 ? "person" : "people"}</dd></div>
        <div><dt>Left out</dt><dd>{review.exclusionCount}</dd></div>
      </dl>
      <p className="field-help">{review.projection.dstNote}</p>
      {review.exclusions.length > 0 && (
        <ul className="scheduled-email-exclusions" aria-label="Who is left out and why">
          {review.exclusions.map((entry) => (
            <li key={entry.code}>
              {entry.label}: {entry.count}
              {ageUnknownCodes.has(entry.code) && (
                <> <Link href={`/more/attendee-configuration?event=${encodeURIComponent(eventId)}`}>Set attendee types</Link></>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="field-help">Everyone is checked again when the email is due and just before it is sent, so anyone who has paid, cancelled, transferred or opted out by then is dropped.</p>
      {review.eligibleCount === 0 && <p className="inline-notice error" role="alert">Nobody in this audience can receive this message, so it cannot be saved or approved.</p>}
      <p className="field-help">{note}</p>
      <div className="form-actions">
        {action}
        {secondary}
      </div>
    </div>
  );
}
