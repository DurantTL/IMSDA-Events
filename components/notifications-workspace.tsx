"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail, Save } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StaffPageHeader } from "@/components/staff-page-header";
import { cardCell } from "@/components/table-card-labels";
import { notificationCatalog, type NotificationDefinition, type NotificationKey } from "@/modules/notifications/catalog";
import type { EventStaffListSummary } from "@/modules/notifications/event-lists";
import type { NotificationSwitch } from "@/modules/notifications/settings";

type Addresses = {
  supportContact: string | null;
  securityAlertEmail: string | null;
  newClubApplicationEmail: string | null;
};

type AddressDraft = { [K in keyof Addresses]: string };

function draftFrom(addresses: Addresses): AddressDraft {
  return {
    supportContact: addresses.supportContact ?? "",
    securityAlertEmail: addresses.securityAlertEmail ?? "",
    newClubApplicationEmail: addresses.newClubApplicationEmail ?? "",
  };
}

const failedMessage = "The notification settings could not be saved.";

async function readMessage(response: Response) {
  const result = await response.json().catch(() => ({}));
  return { result, message: typeof result.message === "string" ? result.message : failedMessage };
}

/**
 * System management > Notifications (#1016): every automatic staff alert with
 * its recipients and an on/off switch, plus the three platform addresses the
 * alerts use. The server checks the system administrator role on every request;
 * nothing here is the protection. Turning the sign-in lockout alert off asks
 * first, and the server asks again (it refuses without `confirmed`).
 */
export function NotificationsWorkspace({
  switches: initialSwitches,
  addresses: initialAddresses,
  events,
}: {
  switches: NotificationSwitch[];
  addresses: Addresses;
  events: EventStaffListSummary[];
}) {
  const [switches, setSwitches] = useState(initialSwitches);
  const [addresses, setAddresses] = useState(initialAddresses);
  const [draft, setDraft] = useState(() => draftFrom(initialAddresses));
  const [busyKey, setBusyKey] = useState<NotificationKey | null>(null);
  const [pending, setPending] = useState<NotificationDefinition | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [rowErrors, setRowErrors] = useState<Partial<Record<NotificationKey, string>>>({});
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [addressError, setAddressError] = useState("");

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(addresses));
  const isOn = (key: NotificationKey) => switches.find((entry) => entry.key === key)?.enabled ?? true;

  async function change(definition: NotificationDefinition, enabled: boolean, confirmed: boolean) {
    setBusyKey(definition.key);
    setNotice("");
    setDialogError("");
    setRowErrors((current) => ({ ...current, [definition.key]: undefined }));
    try {
      const response = await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: definition.key, enabled, ...(confirmed ? { confirmed: true } : {}) }),
      });
      const { result, message } = await readMessage(response);
      if (!response.ok || !Array.isArray(result.switches)) throw new Error(message);
      setSwitches(result.switches);
      setPending(null);
      setNotice(`${definition.name} is now ${enabled ? "on" : "off"}.`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : failedMessage;
      if (pending) setDialogError(message);
      else setRowErrors((current) => ({ ...current, [definition.key]: message }));
    } finally {
      setBusyKey(null);
    }
  }

  function flip(definition: NotificationDefinition) {
    if (busyKey) return;
    const next = !isOn(definition.key);
    if (!next && definition.confirmBeforeOff) {
      setDialogError("");
      setPending(definition);
      return;
    }
    void change(definition, next, false);
  }

  async function saveAddresses(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    setSaving(true);
    setAddressError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: draft }),
      });
      const { result, message } = await readMessage(response);
      if (!response.ok || !result.addresses) throw new Error(message);
      setAddresses(result.addresses);
      setDraft(draftFrom(result.addresses));
      setNotice("Alert addresses saved.");
    } catch (caught) {
      setAddressError(caught instanceof Error ? caught.message : failedMessage);
    } finally {
      setSaving(false);
    }
  }

  function field(key: keyof AddressDraft) {
    return {
      value: draft[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => (
        setDraft((current) => ({ ...current, [key]: event.target.value }))
      ),
    };
  }

  return (
    <section className="page-stack notifications-page">
      <StaffPageHeader
        description={(
          <>
            Every automatic email to staff and club leaders, who gets it, and a switch for each. Everything is on until you turn it off.{" "}
            <Link className="text-button" href="/communications">Open the delivery log</Link>
          </>
        )}
      />

      {notice && <p className="inline-notice" role="status">{notice}</p>}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><Mail aria-hidden="true" size={14} /> Staff alerts</p>
            <h2>Automatic emails</h2>
          </div>
        </div>
        <p className="field-help">
          Emails to attendees about their own registration, and emails a person sends on purpose (reminders, invoices), are not listed here.
        </p>
        <div className="report-table-wrap">
          <table className="report-table table-cards notifications-table" role="table">
            <caption className="sr-only">Automatic staff alerts</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Alert</th>
                <th role="columnheader" scope="col">Sent to</th>
                <th role="columnheader" scope="col">Switch</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {notificationCatalog.map((definition) => {
                const on = isOn(definition.key);
                const error = rowErrors[definition.key];
                return (
                  <tr data-notification={definition.key} data-state={on ? "on" : "off"} key={definition.key} role="row">
                    <th role="rowheader" scope="row">
                      {definition.name}
                      <small className="quiet-copy notification-description">{definition.when}</small>
                    </th>
                    <td {...cardCell("Sent to")}>
                      {definition.recipients}
                      <small className="quiet-copy notification-description">
                        {definition.sourceNote}{" "}
                        {definition.source.kind === "platform-address" && (
                          <a className="text-button" href="#alert-addresses">Edit the address</a>
                        )}
                        {definition.source.kind === "club-form-list" && (
                          <Link className="text-button" href="/admin/club-forms">Open the club forms</Link>
                        )}
                        {definition.source.kind === "event-list" && (
                          <a className="text-button" href="#event-lists">See each event</a>
                        )}
                      </small>
                    </td>
                    <td {...cardCell("Switch")}>
                      <button
                        aria-checked={on}
                        aria-label={`${definition.name}: ${on ? "on" : "off"}. Press to turn ${on ? "off" : "on"}.`}
                        className="feature-switch"
                        data-on={on ? "true" : "false"}
                        disabled={busyKey !== null}
                        onClick={() => flip(definition)}
                        role="switch"
                        type="button"
                      >
                        <span aria-hidden="true" className="feature-switch-track"><span className="feature-switch-thumb" /></span>
                        <span>{busyKey === definition.key ? "Saving…" : on ? "On" : "Off"}</span>
                      </button>
                      {!definition.built && <small className="quiet-copy notification-description">Not sent yet.</small>}
                      {error && <p className="form-error" role="alert">{error}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <form className="panel form-stack" id="alert-addresses" onSubmit={saveAddresses}>
        <div className="section-heading">
          <div>
            <p className="eyebrow"><Mail aria-hidden="true" size={14} /> Platform addresses</p>
            <h2>Where three of the alerts go</h2>
          </div>
        </div>
        {addressError && <p className="form-error" role="alert">{addressError}</p>}
        <label>
          New club application address
          <input type="email" placeholder="youth-assistant@example.org" {...field("newClubApplicationEmail")} />
          <small>
            Gets a short notice (club name, church and director name, with a link) when someone applies to start a new club.
            No phone, address or attachment is ever emailed. Leave blank to send no notice; applications still wait in the queue.
          </small>
        </label>
        <label>
          Security alert address
          <input type="email" placeholder="security@imsda.org" {...field("securityAlertEmail")} />
          <small>
            Gets a short alert when a staff, club leader or attendee sign-in locks after too many wrong passwords or two-step codes,
            as well as the account holder. Leave blank to tell only the account holder.
          </small>
        </label>
        <label>
          Support contact
          <input type="email" placeholder="support@imsda.org" {...field("supportContact")} />
          <small>Gets event feature requests. It is also the platform&apos;s support contact.</small>
        </label>
        <div className="form-actions">
          {dirty && <span className="unsaved-dot" role="status">Unsaved changes</span>}
          <button className="primary-button" type="submit" disabled={saving || !dirty}>
            <Save aria-hidden="true" size={16} /> {saving ? "Saving…" : "Save addresses"}
          </button>
        </div>
      </form>

      <section className="panel" id="event-lists">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><Mail aria-hidden="true" size={14} /> Per event</p>
            <h2>Staff notification lists</h2>
          </div>
        </div>
        <p className="field-help">
          New registrations and registrations waiting for approval go to each event&apos;s own list. Open an event&apos;s Communications page to change it.
        </p>
        {events.length === 0 ? (
          <p className="quiet-copy">There are no active events.</p>
        ) : (
          <ul className="notification-event-list">
            {events.map((event) => (
              <li key={event.eventId}>
                <span>
                  <strong>{event.eventName}</strong>
                  <small className="quiet-copy">
                    {event.addressCount === 0 ? "No staff addresses" : `${event.addressCount} staff address${event.addressCount === 1 ? "" : "es"}`}
                  </small>
                </span>
                <Link
                  aria-label={`Communications for ${event.eventName}`}
                  className="secondary-button"
                  href={`/communications?event=${encodeURIComponent(event.eventId)}`}
                >
                  Communications
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        busy={busyKey !== null}
        busyLabel="Saving…"
        confirmLabel="Turn it off"
        destructive
        error={dialogError}
        onCancel={() => { setPending(null); setDialogError(""); }}
        onConfirm={() => { if (pending) void change(pending, false, true); }}
        open={pending !== null}
        title={pending?.confirmBeforeOff?.title ?? ""}
      >
        <p>{pending?.confirmBeforeOff?.message}</p>
      </ConfirmDialog>
    </section>
  );
}
