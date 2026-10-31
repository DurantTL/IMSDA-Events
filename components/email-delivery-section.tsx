"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mail, Pause, Play, Save } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cardCell } from "@/components/table-card-labels";
import type { EventEmailState } from "@/modules/communications/event-email-pause";

export type CentralSenderView = { name: string; email: string; replyTo: string };

/** The heading for the real state: sending, waiting for a central sender, or captured locally. */
export function deliveryHeading(platformConfigured: boolean, senderMissing: boolean): string {
  if (platformConfigured) return "Real email is on for every event";
  if (senderMissing) return "Emails are waiting for a central sender";
  return "Email is captured here, not sent";
}

const failedMessage = "The email settings could not be saved.";

async function readMessage(response: Response) {
  const result = await response.json().catch(() => ({}));
  return { result, message: typeof result.message === "string" ? result.message : failedMessage };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * System management > Email > Delivery & sender (#1043). Real email is on for every event by default; this is where a
 * system administrator sets the one central sender (name, email, reply-to) and pauses or resumes a single event (a test
 * event, for example). Event staff never see this. The server checks the system administrator role on every request;
 * nothing here is the protection.
 */
export function EmailDeliverySection({
  sender: initialSender,
  events: initialEvents,
  platformConfigured: initialConfigured,
  senderMissing: initialSenderMissing = false,
}: {
  sender: CentralSenderView;
  events: EventEmailState[];
  /** Whether real email can leave this environment at all (provider, account sender and central sender address). */
  platformConfigured: boolean;
  /** The environment can send but the central sender address is blank: messages are waiting, not sent and not lost. */
  senderMissing?: boolean;
}) {
  // The sender address saved in this visit, if any, decides the "sender missing" state without a reload: the page props were read before the save.
  const [savedSenderEmail, setSavedSenderEmail] = useState<string | null>(null);
  const router = useRouter();
  const [sender, setSender] = useState(initialSender);
  const [draft, setDraft] = useState(initialSender);
  const [events, setEvents] = useState(initialEvents);
  const [notice, setNotice] = useState("");
  const [senderError, setSenderError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickedEventId, setPickedEventId] = useState("");
  const [pending, setPending] = useState<{ event: EventEmailState; paused: boolean } | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [busy, setBusy] = useState(false);

  const canSend = initialConfigured || initialSenderMissing;
  const senderBlank = savedSenderEmail === null ? initialSenderMissing : !savedSenderEmail.trim();
  const senderMissing = canSend && senderBlank;
  const platformConfigured = canSend && !senderBlank;
  const dirty = JSON.stringify(draft) !== JSON.stringify(sender);
  const paused = events.filter((event) => event.paused);
  const pausable = events.filter((event) => !event.paused && !event.archived);

  async function saveSender(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    setSaving(true);
    setSenderError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { defaultSenderName: draft.name, defaultSenderEmail: draft.email, defaultReplyToEmail: draft.replyTo },
        }),
      });
      const { result, message } = await readMessage(response);
      if (!response.ok || !result.sender) throw new Error(message);
      const saved = {
        name: result.sender.defaultSenderName ?? "",
        email: result.sender.defaultSenderEmail ?? "",
        replyTo: result.sender.defaultReplyToEmail ?? "",
      };
      setSender(saved);
      setDraft(saved);
      setSavedSenderEmail(saved.email);
      router.refresh();
      setNotice("Central sender saved.");
    } catch (caught) {
      setSenderError(caught instanceof Error ? caught.message : failedMessage);
    } finally {
      setSaving(false);
    }
  }

  async function confirmChange() {
    if (!pending) return;
    setBusy(true);
    setDialogError("");
    try {
      const response = await fetch("/api/admin/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: pending.event.eventId, paused: pending.paused }),
      });
      const { result, message } = await readMessage(response);
      if (!response.ok || !Array.isArray(result.events)) throw new Error(message);
      setEvents(result.events);
      setNotice(`Email is now ${pending.paused ? "paused" : "on"} for ${pending.event.eventName}.`);
      setPickedEventId("");
      setPending(null);
    } catch (caught) {
      setDialogError(caught instanceof Error ? caught.message : failedMessage);
    } finally {
      setBusy(false);
    }
  }

  function field(key: keyof CentralSenderView) {
    return {
      value: draft[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  const pickedEvent = pausable.find((event) => event.eventId === pickedEventId) ?? null;

  return (
    <>
      {notice && <p className="inline-notice" role="status">{notice}</p>}

      <form className="panel form-stack" id="delivery-and-sender" onSubmit={saveSender}>
        <div className="section-heading">
          <div>
            <p className="eyebrow"><Mail aria-hidden="true" size={14} /> Delivery &amp; sender</p>
            <h2>{deliveryHeading(platformConfigured, senderMissing)}</h2>
          </div>
        </div>
        {senderMissing && (
          <p className="inline-notice error" data-email-environment="sender-missing" role="alert">
            Central sender not set; emails are waiting. Real email is configured here, but until a sender email is saved below no event can send.
            Messages queue and are neither sent nor lost, and they go out once the sender is set.
          </p>
        )}
        <p className="field-help" data-email-environment={platformConfigured ? "configured" : senderMissing ? "sender-missing" : "not-configured"}>
          {platformConfigured
            ? "Real email is configured in this environment. Every event sends real email unless it is paused below."
            : senderMissing
              ? "Real email is configured in this environment, but the sender email below is blank."
              : "Real email is not configured in this environment (the email provider or the account email sender is missing), so every event captures email locally instead of sending it."}
        </p>
        {senderError && <p className="form-error" role="alert">{senderError}</p>}
        <label>
          Sender name
          <input required minLength={2} maxLength={120} {...field("name")} />
          <small>The default display name. An event can use its own, for example &quot;IMSDA Women&apos;s Retreat&quot;.</small>
        </label>
        <label>
          Sender email (From address)
          <input type="email" placeholder="registration@imsda.org" {...field("email")} />
          <small>Every event sends from this address; an event cannot change it. It must be verified with the email provider.</small>
        </label>
        <label>
          Reply-to address
          <input type="email" placeholder="registration@imsda.org" {...field("replyTo")} />
          <small>Where replies go unless an event sets its own reply-to.</small>
        </label>
        <div className="form-actions">
          {dirty && <span className="unsaved-dot" role="status">Unsaved changes</span>}
          <button className="primary-button" type="submit" disabled={saving || !dirty}>
            <Save aria-hidden="true" size={16} /> {saving ? "Saving…" : "Save sender"}
          </button>
        </div>
      </form>

      <section className="panel" id="paused-events">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><Pause aria-hidden="true" size={14} /> Paused events</p>
            <h2>Events with email paused</h2>
          </div>
        </div>
        <p className="field-help">
          A paused event captures email and sends nothing, for example a test event. Events that were set to capture only or off
          before this page existed start out paused so nothing old starts sending; resume the real ones.
        </p>
        {paused.length === 0 ? (
          <p className="quiet-copy">No events are paused.</p>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table table-cards" role="table">
              <caption className="sr-only">Events with email paused</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Event</th>
                  <th role="columnheader" scope="col">Paused since</th>
                  <th role="columnheader" scope="col"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {paused.map((event) => (
                  <tr data-event-id={event.eventId} key={event.eventId} role="row">
                    <th role="rowheader" scope="row">
                      {event.eventName}
                      <small className="quiet-copy notification-description">
                        {formatDate(event.startsAt)}{event.archived ? " (archived)" : ""}
                      </small>
                    </th>
                    <td {...cardCell("Paused since")}>{event.pausedAt ? formatDate(event.pausedAt) : "Before this page existed"}</td>
                    <td {...cardCell("Action")}>
                      <button
                        aria-label={`Resume email for ${event.eventName}`}
                        className="secondary-button"
                        onClick={() => { setDialogError(""); setPending({ event, paused: false }); }}
                        type="button"
                      >
                        <Play aria-hidden="true" size={16} /> Resume
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="form-stack">
          <label>
            Pause another event
            <select value={pickedEventId} onChange={(event) => setPickedEventId(event.target.value)}>
              <option value="">Choose an event…</option>
              {pausable.map((event) => (
                <option key={event.eventId} value={event.eventId}>{event.eventName} ({formatDate(event.startsAt)})</option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button
              className="secondary-button"
              disabled={!pickedEvent}
              onClick={() => { if (pickedEvent) { setDialogError(""); setPending({ event: pickedEvent, paused: true }); } }}
              type="button"
            >
              <Pause aria-hidden="true" size={16} /> Pause email
            </button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        busy={busy}
        busyLabel="Saving…"
        confirmLabel={pending?.paused ? "Pause email" : "Resume email"}
        destructive={pending?.paused === false}
        error={dialogError}
        onCancel={() => { setPending(null); setDialogError(""); }}
        onConfirm={() => void confirmChange()}
        open={pending !== null}
        title={pending?.paused ? "Pause email for this event?" : "Resume real email for this event?"}
      >
        {pending?.paused ? (
          <p>
            Nothing will be sent for <strong>{pending.event.eventName}</strong>. New messages are captured, not delivered, until you resume it.
          </p>
        ) : (
          <p>
            <strong>{pending?.event.eventName}</strong> will send real email to registrants again, from the central sender. Messages already
            captured while it was paused are not sent.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
