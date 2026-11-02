"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Ban, Copy, MailPlus, RefreshCw, UserPlus } from "lucide-react";
import { INVITATION_BULK_LIMIT } from "@/modules/staff-invitations/list-query";

/**
 * The interactive half of the invite list (#804, #1492). The list itself is a server page: the database filters, orders and
 * pages it, and the table is rendered on the server. What needs the browser lives here: the ticks, "Select all N matching",
 * and the Send, Revoke, copy, reissue and re-invite actions. The ticks live in a provider around the table, so they stay
 * while the person pages, sorts or filters.
 */

type SendPreview = {
  willSend: number;
  skipped: number;
  deliveryMode: string;
  senderName: string;
  linksOpen: boolean;
  digest: string;
  sample: { to: string; subject: string; bodyText: string } | null;
};

type Selection = {
  eventId: string;
  canSend: boolean;
  total: number;
  /** The address's filters as a query string (no sort or page), which the server re-runs to find every matching id. */
  matchingQuery: string;
  pageIds: readonly string[];
  selected: ReadonlySet<string>;
  busy: boolean;
  toggle: (id: string) => void;
  showLink: (id: string, action: "copy" | "reissue") => Promise<void>;
  reinvite: (id: string) => Promise<void>;
};

const SelectionContext = createContext<Selection | null>(null);

function useSelection() {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("The invite list actions must sit inside InvitationSelectionProvider.");
  return value;
}

type Chrome = {
  error: string;
  notice: string;
  sendPreview: SendPreview | null;
  revealed: { id: string; url: string } | null;
  confirmingRevoke: boolean;
  selectAllMatching: () => Promise<void>;
  clearSelection: () => void;
  openSendPreview: () => Promise<void>;
  confirmSend: () => Promise<void>;
  revoke: () => Promise<void>;
  setSendPreview: (value: SendPreview | null) => void;
  setRevealed: (value: { id: string; url: string } | null) => void;
  setConfirmingRevoke: (value: boolean) => void;
};

const ChromeContext = createContext<Chrome | null>(null);

function useChrome() {
  const value = useContext(ChromeContext);
  if (!value) throw new Error("The invite list actions must sit inside InvitationSelectionProvider.");
  return value;
}

export function InvitationSelectionProvider({ eventId, canSend, total, matchingQuery, pageIds, children }: {
  eventId: string;
  /** MANAGE_COMMUNICATIONS: sending is a bulk communication and needs it. */
  canSend: boolean;
  total: number;
  matchingQuery: string;
  pageIds: readonly string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sendPreview, setSendPreview] = useState<SendPreview | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; url: string } | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
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

  /** "Select all N matching": the server finds every invitation of this event the filters match (all pages), up to the most one Send takes. */
  const selectAllMatching = () => run(async () => {
    const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/staff-invitations/matching-ids${matchingQuery ? `?${matchingQuery}` : ""}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({})) as { ids?: string[]; message?: string };
    if (!response.ok || !result.ids) throw new Error(result.message ?? "The matching people could not be selected.");
    const ids = result.ids;
    changeSelection((current) => new Set([...current, ...ids]));
  });

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
    <SelectionContext.Provider value={{ eventId, canSend, total, matchingQuery, pageIds, selected, busy, toggle, showLink, reinvite }}>
      <ChromeContext.Provider
        value={{
          error, notice, sendPreview, revealed, confirmingRevoke,
          selectAllMatching, clearSelection: () => changeSelection(() => new Set()),
          openSendPreview, confirmSend, revoke, setSendPreview, setRevealed, setConfirmingRevoke,
        }}
      >
        {children}
      </ChromeContext.Provider>
    </SelectionContext.Provider>
  );
}

/** The selection bar and the messages, previews and confirmations that follow from it. */
export function InvitationSelectionBar() {
  const { canSend, total, pageIds, selected, busy } = useSelection();
  const chrome = useChrome();
  const pageSelected = pageIds.filter((id) => selected.has(id)).length;
  return (
    <>
      <div className="panel selection-bar">
        <span role="status">
          {selected.size > 0 ? <><strong>{selected.size}</strong> selected{pageSelected !== selected.size ? ` · ${pageSelected} on this page` : ""}</> : "Tick people, or use Select all."}
        </span>
        <div className="selection-bar-actions">
          {total > INVITATION_BULK_LIMIT
            ? <small>Narrow the list to {INVITATION_BULK_LIMIT.toLocaleString("en-US")} or fewer to select them all.</small>
            : (selected.size < total || pageSelected < pageIds.length) && (
              <button className="text-button" disabled={busy} onClick={() => void chrome.selectAllMatching()} type="button">Select all {total} matching</button>
            )}
          {selected.size > 0 && (
            <>
              <button className="text-button" onClick={chrome.clearSelection} type="button">Clear selection</button>
              {canSend && (
                <button className="secondary-button outline-action" disabled={busy} onClick={() => void chrome.openSendPreview()} type="button">
                  <MailPlus aria-hidden="true" size={16} /> Send or resend…
                </button>
              )}
              <button className="secondary-button outline-action" disabled={busy} onClick={() => chrome.setConfirmingRevoke(true)} type="button">
                <Ban aria-hidden="true" size={16} /> Revoke…
              </button>
            </>
          )}
        </div>
      </div>

      {chrome.error && <div className="inline-notice error" role="alert">{chrome.error}</div>}
      {chrome.notice && <div className="inline-notice" role="status">{chrome.notice}</div>}
      {chrome.revealed && (
        <div className="staff-invite-preview">
          <label>
            Personal link (give it only to this person)
            <input onFocus={(focusEvent) => focusEvent.currentTarget.select()} readOnly value={chrome.revealed.url} />
          </label>
          <button className="text-button" onClick={() => chrome.setRevealed(null)} type="button">Hide link</button>
        </div>
      )}

      {chrome.confirmingRevoke && (
        <div className="staff-invite-preview" role="alertdialog" aria-label="Confirm revoke">
          <p>Revoke the links of the {selected.size} selected {selected.size === 1 ? "person" : "people"}? Their links stop working at once. People who have already registered are not affected, and nothing is emailed.</p>
          <div className="intro-actions">
            <button className="primary-button" disabled={busy} onClick={() => void chrome.revoke()} type="button">Revoke {selected.size}</button>
            <button className="text-button" onClick={() => chrome.setConfirmingRevoke(false)} type="button">Cancel</button>
          </div>
        </div>
      )}

      {chrome.sendPreview && (
        <div className="staff-invite-preview" role="alertdialog" aria-label="Preview the invitation email">
          {chrome.sendPreview.willSend === 0 ? (
            <p>Nobody selected can be sent a link right now (revoked, already registered, or sent a moment ago).</p>
          ) : (
            <>
              <p>
                <strong>{chrome.sendPreview.willSend}</strong> invitation email{chrome.sendPreview.willSend === 1 ? "" : "s"} will be queued from {chrome.sendPreview.senderName}
                {chrome.sendPreview.skipped > 0 ? `; ${chrome.sendPreview.skipped} skipped (revoked, registered, or sent a moment ago)` : ""}.
                {chrome.sendPreview.deliveryMode === "EXTERNAL_EMAIL" ? " They will be delivered to real inboxes." : chrome.sendPreview.deliveryMode === "DISABLED" ? " Email delivery is turned off for this event, so they will be suppressed." : " This event captures email locally, so nothing leaves the system."}
              </p>
              {!chrome.sendPreview.linksOpen && (
                <p className="inline-notice error" role="note">The event is not published, or it is over, so these links will not open. Publish the event before sending them.</p>
              )}
              {chrome.sendPreview.sample && (
                <>
                  <p className="field-help">The first email, to {chrome.sendPreview.sample.to}. Everyone gets the same words with their own name and their own personal link (shown here as a placeholder).</p>
                  <p><strong>{chrome.sendPreview.sample.subject}</strong></p>
                  <pre>{chrome.sendPreview.sample.bodyText}</pre>
                </>
              )}
              <div className="intro-actions">
                <button className="primary-button" disabled={busy} onClick={() => void chrome.confirmSend()} type="button">Send {chrome.sendPreview.willSend}</button>
                <button className="text-button" onClick={() => chrome.setSendPreview(null)} type="button">Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** The tick in a row. */
export function InvitationRowSelect({ id, email }: { id: string; email: string }) {
  const { selected, toggle } = useSelection();
  return <label className="staff-invite-select"><input aria-label={`Select ${email}`} checked={selected.has(id)} onChange={() => toggle(id)} type="checkbox" /></label>;
}

/** The copy, re-invite and reissue buttons in a row. Plain flags in, so the row can be rendered on the server. */
export function InvitationRowActions({ id, usable, reinvitable, reissuable }: { id: string; usable: boolean; reinvitable: boolean; reissuable: boolean }) {
  const { busy, showLink, reinvite } = useSelection();
  return (
    <div className="staff-invite-actions">
      {usable && (
        <button className="text-button" disabled={busy} onClick={() => void showLink(id, "copy")} type="button"><Copy aria-hidden="true" size={14} /> Copy link</button>
      )}
      {reinvitable && (
        <button className="text-button" disabled={busy} onClick={() => void reinvite(id)} type="button"><UserPlus aria-hidden="true" size={14} /> Re-invite</button>
      )}
      {reissuable && (
        <button className="text-button" disabled={busy} onClick={() => void showLink(id, "reissue")} type="button"><RefreshCw aria-hidden="true" size={14} /> Reissue</button>
      )}
    </div>
  );
}
