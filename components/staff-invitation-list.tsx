"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Ban, Copy, MailPlus, RefreshCw, UserPlus } from "lucide-react";
import {
  INVITATION_STATUSES,
  INVITATION_STATUS_LABEL,
  STAFF_INVITATION_GROUPS,
  STAFF_INVITATION_GROUP_LABEL,
  type InvitationStatus,
  type StaffInvitationGroupValue,
} from "@/modules/staff-invitations/domain";
import type { InvitationListRow } from "@/modules/staff-invitations/repository";
import { formatPersonName } from "@/lib/person-name";

type SendPreview = {
  willSend: number;
  skipped: number;
  deliveryMode: string;
  senderName: string;
  linksOpen: boolean;
  digest: string;
  sample: { to: string; subject: string; bodyText: string } | null;
};

type Props = {
  eventId: string;
  rows: InvitationListRow[];
  counts: Record<InvitationStatus, number>;
  truncated: boolean;
  /** MANAGE_COMMUNICATIONS: sending is a bulk communication and needs it. */
  canSend: boolean;
};

function tone(status: InvitationStatus) {
  switch (status) {
    case "APPROVED":
    case "SENT":
      return "green";
    case "REGISTERED":
    case "NOT_SENT":
      return "gold";
    case "DELIVERY_FAILED":
    case "DECLINED":
      return "coral";
    default:
      return "neutral";
  }
}

/**
 * The invite list (#804): each person's status, filters, select-all, and the actions on the selection. Revoke is for links nobody
 * has used. Sending is a person's explicit action: Send opens a preview of the exact email and how many go, and nothing is
 * queued until that is confirmed. The emails are queued in the event's outbox; this never delivers anything itself.
 */
export function StaffInvitationList({ eventId, rows, counts, truncated, canSend }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<InvitationStatus | "ALL">("ALL");
  const [group, setGroup] = useState<StaffInvitationGroupValue | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sendPreview, setSendPreview] = useState<SendPreview | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; url: string } | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => (
      (status === "ALL" || row.status === status)
      && (group === "ALL" || row.group === group)
      && (!needle || `${row.email} ${formatPersonName(row)}`.toLowerCase().includes(needle))
    ));
  }, [rows, status, group, query]);
  const visibleSelected = visible.filter((row) => selected.has(row.id));
  const selectedIds = [...selected];

  // A preview describes exactly one selection: any change to the selection discards it (and a pending revoke confirmation).
  function changeSelection(update: (current: Set<string>) => Set<string>) {
    setSelected(update);
    setSendPreview(null);
    setConfirmingRevoke(false);
  }

  function toggle(id: string) {
    changeSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function call(path: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/staff-invitations${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown> & { message?: string };
    if (!response.ok) throw new Error(result.message ?? "That couldn't be done. Nothing was changed.");
    return result;
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That couldn't be done. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const openSendPreview = () => run(async () => {
    const result = await call("/send", { action: "preview", ids: selectedIds });
    setSendPreview(result.preview as SendPreview);
  });

  const confirmSend = () => run(async () => {
    if (!sendPreview) return;
    const result = await call("/send", { action: "send", ids: selectedIds, digest: sendPreview.digest }) as { result?: { queued: number } };
    setNotice(`${result.result?.queued ?? 0} invitation email${result.result?.queued === 1 ? "" : "s"} queued in the message outbox for delivery.`);
    setSendPreview(null);
    setSelected(new Set());
    router.refresh();
  });

  const revoke = () => run(async () => {
    const result = await call("/actions", { action: "revoke", ids: selectedIds }) as { result?: { revoked: number; skipped: number } };
    setNotice(`${result.result?.revoked ?? 0} link${result.result?.revoked === 1 ? "" : "s"} revoked${result.result?.skipped ? `, ${result.result.skipped} skipped (already used or revoked)` : ""}.`);
    setConfirmingRevoke(false);
    setSelected(new Set());
    router.refresh();
  });

  // Re-invite makes a new invitation (a new link, "not sent"); it never emails anyone. The office then selects it and uses Send.
  const reinvite = (id: string) => run(async () => {
    await call(`/${encodeURIComponent(id)}`, { action: "reinvite" });
    setNotice("A new invitation was made with a new link, and the old link no longer works. Nothing was emailed: select the new invitation and use Send or resend to email it.");
    router.refresh();
  });

  const showLink = (id: string, action: "copy" | "reissue") => run(async () => {
    const result = await call(`/${encodeURIComponent(id)}`, { action }) as { result?: { url: string } };
    const url = result.result?.url ?? "";
    setRevealed({ id, url });
    try {
      await navigator.clipboard.writeText(url);
      setNotice(action === "copy" ? "Link copied." : "A new link was made and copied. Earlier copies no longer work. Nothing was emailed.");
    } catch {
      setNotice(action === "copy" ? "Copy the link below." : "A new link was made. Copy it below. Earlier copies no longer work. Nothing was emailed.");
    }
    if (action === "reissue") router.refresh();
  });

  return (
    <section className="panel form-stack" aria-labelledby="staff-invite-list-title">
      <div className="section-heading">
        <div>
          <h3 id="staff-invite-list-title">Invite list</h3>
          <p className="field-help">
            {INVITATION_STATUSES.filter((entry) => counts[entry] > 0).map((entry) => `${counts[entry]} ${INVITATION_STATUS_LABEL[entry].toLowerCase()}`).join(" · ") || "Nobody invited yet."}
          </p>
        </div>
      </div>
      <div className="staff-invite-filters">
        <label>
          Status
          <select onChange={(changeEvent) => setStatus(changeEvent.target.value as InvitationStatus | "ALL")} value={status}>
            <option value="ALL">All statuses</option>
            {INVITATION_STATUSES.map((entry) => <option key={entry} value={entry}>{INVITATION_STATUS_LABEL[entry]} ({counts[entry]})</option>)}
          </select>
        </label>
        <label>
          Group
          <select onChange={(changeEvent) => setGroup(changeEvent.target.value as StaffInvitationGroupValue | "ALL")} value={group}>
            <option value="ALL">All groups</option>
            {STAFF_INVITATION_GROUPS.map((entry) => <option key={entry} value={entry}>{STAFF_INVITATION_GROUP_LABEL[entry]}</option>)}
          </select>
        </label>
        <label>
          Search
          <input onChange={(changeEvent) => setQuery(changeEvent.target.value)} placeholder="Name or email" type="search" value={query} />
        </label>
      </div>

      <div className="panel selection-bar">
        <span role="status">
          {selected.size > 0 ? <><strong>{selected.size}</strong> selected{visibleSelected.length !== selected.size ? ` · ${visibleSelected.length} in this view` : ""}</> : "Tick people, or use Select all."}
        </span>
        <div className="selection-bar-actions">
          {visibleSelected.length < visible.length && (
            <button className="text-button" onClick={() => changeSelection((current) => new Set([...current, ...visible.map((row) => row.id)]))} type="button">Select all {visible.length} shown</button>
          )}
          {selected.size > 0 && (
            <>
              <button className="text-button" onClick={() => changeSelection(() => new Set())} type="button">Clear selection</button>
              {canSend && (
                <button className="secondary-button outline-action" disabled={busy} onClick={() => void openSendPreview()} type="button">
                  <MailPlus aria-hidden="true" size={16} /> Send or resend…
                </button>
              )}
              <button className="secondary-button outline-action" disabled={busy} onClick={() => setConfirmingRevoke(true)} type="button">
                <Ban aria-hidden="true" size={16} /> Revoke…
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}
      {revealed && (
        <div className="staff-invite-preview">
          <label>
            Personal link (give it only to this person)
            <input onFocus={(focusEvent) => focusEvent.currentTarget.select()} readOnly value={revealed.url} />
          </label>
          <button className="text-button" onClick={() => setRevealed(null)} type="button">Hide link</button>
        </div>
      )}

      {confirmingRevoke && (
        <div className="staff-invite-preview" role="alertdialog" aria-label="Confirm revoke">
          <p>Revoke the links of the {selected.size} selected {selected.size === 1 ? "person" : "people"}? Their links stop working at once. People who have already registered are not affected, and nothing is emailed.</p>
          <div className="intro-actions">
            <button className="primary-button" disabled={busy} onClick={() => void revoke()} type="button">Revoke {selected.size}</button>
            <button className="text-button" onClick={() => setConfirmingRevoke(false)} type="button">Cancel</button>
          </div>
        </div>
      )}

      {sendPreview && (
        <div className="staff-invite-preview" role="alertdialog" aria-label="Preview the invitation email">
          {sendPreview.willSend === 0 ? (
            <p>Nobody selected can be sent a link right now (revoked, already registered, or sent a moment ago).</p>
          ) : (
            <>
              <p>
                <strong>{sendPreview.willSend}</strong> invitation email{sendPreview.willSend === 1 ? "" : "s"} will be queued from {sendPreview.senderName}
                {sendPreview.skipped > 0 ? `; ${sendPreview.skipped} skipped (revoked, registered, or sent a moment ago)` : ""}.
                {sendPreview.deliveryMode === "EXTERNAL_EMAIL" ? " They will be delivered to real inboxes." : sendPreview.deliveryMode === "DISABLED" ? " Email delivery is turned off for this event, so they will be suppressed." : " This event captures email locally, so nothing leaves the system."}
              </p>
              {!sendPreview.linksOpen && (
                <p className="inline-notice error" role="note">The event is not published, or it is over, so these links will not open. Publish the event before sending them.</p>
              )}
              {sendPreview.sample && (
                <>
                  <p className="field-help">The first email, to {sendPreview.sample.to}. Everyone gets the same words with their own name and their own personal link (shown here as a placeholder).</p>
                  <p><strong>{sendPreview.sample.subject}</strong></p>
                  <pre>{sendPreview.sample.bodyText}</pre>
                </>
              )}
              <div className="intro-actions">
                <button className="primary-button" disabled={busy} onClick={() => void confirmSend()} type="button">Send {sendPreview.willSend}</button>
                <button className="text-button" onClick={() => setSendPreview(null)} type="button">Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="empty-state">{rows.length === 0 ? "Import a CSV above to create the first personal links." : "Nobody matches these filters."}</p>
      ) : (
        <div className="report-table-wrap card-box">
          <table className="report-table staff-invite-table">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Select</span></th>
                <th scope="col">Person</th>
                <th scope="col">Group</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td><label className="staff-invite-select"><input aria-label={`Select ${row.email}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} type="checkbox" /></label></td>
                  <td data-label="Person">
                    <strong>{formatPersonName(row) || row.email}</strong>
                    {(row.firstName || row.lastName) && <><br /><span className="field-help">{row.email}</span></>}
                  </td>
                  <td data-label="Group">{STAFF_INVITATION_GROUP_LABEL[row.group]}</td>
                  <td data-label="Status">
                    <span className={`status-chip ${tone(row.status)}`}>{INVITATION_STATUS_LABEL[row.status]}</span>
                    {row.sentAt && row.status !== "REGISTERED" && row.status !== "APPROVED" && row.status !== "DECLINED" && (
                      <><br /><span className="field-help">Sent {row.sendCount > 1 ? `${row.sendCount} times, last ` : ""}{row.sentAt.slice(0, 16).replace("T", " ")} UTC</span></>
                    )}
                    {row.deliveryNote && <><br /><span className="field-help">{row.deliveryNote}</span></>}
                    {row.confirmationCode && <><br /><span className="field-help">{row.confirmationCode}</span></>}
                  </td>
                  <td data-label="Actions">
                    <div className="staff-invite-actions">
                      {row.usable && (
                        <button className="text-button" disabled={busy} onClick={() => void showLink(row.id, "copy")} type="button"><Copy aria-hidden="true" size={14} /> Copy link</button>
                      )}
                      {row.reinvitable && (
                        <button className="text-button" disabled={busy} onClick={() => void reinvite(row.id)} type="button"><UserPlus aria-hidden="true" size={14} /> Re-invite</button>
                      )}
                      {row.reissuable && (
                        <button className="text-button" disabled={busy} onClick={() => void showLink(row.id, "reissue")} type="button"><RefreshCw aria-hidden="true" size={14} /> Reissue</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {truncated && <p className="field-help">Showing the first 2,000 people.</p>}
    </section>
  );
}
