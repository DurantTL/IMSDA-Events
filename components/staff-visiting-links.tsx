"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { EmailInput } from "@/components/email-input";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "@/components/staff-visiting-clubs.module.css";
import type { VisitingEventOption, VisitingInviteRecord } from "@/modules/visiting-clubs/repository";

const stateLabels = { OPEN: "Not used yet", USED: "Used", CANCELLED: "Cancelled", EXPIRED: "Expired" } as const;

/**
 * The Visiting clubs view's link tools (#835): email a visiting director a private link for one club event, and the links
 * sent so far with Withdraw for the unused ones. The routes decide who may use it.
 */
export function StaffVisitingLinks({ events, invites, emailConfigured, canOpenSetup = false }: { events: VisitingEventOption[]; invites: VisitingInviteRecord[]; emailConfigured: boolean; canOpenSetup?: boolean }) {
  const router = useRouter();
  const [eventId, setEventId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "success" } | null>(null);
  const { confirm: askConfirm, confirmDialog } = useConfirm();

  // Typed values not yet sent.
  useUnsavedChangesGuard(email.trim() !== "" || name.trim() !== "", "You have typed something here that has not been sent. Leave this page and discard it?");

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/visiting-clubs/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, email, name }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The link could not be sent.");
      setMessage({ text: `A private link was emailed to ${email.trim().toLowerCase()}.`, tone: "success" });
      setEmail("");
      setName("");
      router.refresh();
    } catch (caught) {
      setMessage({ text: caught instanceof Error ? caught.message : "The link could not be sent.", tone: "error" });
    } finally {
      setBusy(false);
      setSending(false);
    }
  }

  async function withdraw(invite: VisitingInviteRecord) {
    if (!(await askConfirm({
      title: `Withdraw the link sent to ${invite.email}`,
      body: <p>The link stops working right away. You can send a new one.</p>,
      confirmLabel: `Withdraw link for ${invite.email}`,
      destructive: true,
    }))) return;
    setBusy(true);
    setWithdrawingId(invite.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/visiting-clubs/invites/${encodeURIComponent(invite.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The link could not be withdrawn.");
      router.refresh();
    } catch (caught) {
      setMessage({ text: caught instanceof Error ? caught.message : "The link could not be withdrawn.", tone: "error" });
    } finally {
      setBusy(false);
      setWithdrawingId(null);
    }
  }

  return (
    <div className="panel">
      {confirmDialog}
      <div className="section-heading"><div><h2>Send a visiting club link</h2></div></div>
      <p className={styles.help}>
        Email a visiting director a private link for one event. They sign in with that email, tell us about their club, and you approve it before it can register. The club is a guest for that event only, at the same prices, billed to the visiting club.
      </p>
      {!emailConfigured && (
        <div className="inline-notice error" role="status">
          Account email isn&apos;t set up on this server, so links can&apos;t be sent yet. Only a system administrator can set it up
          {canOpenSetup ? <>: open the <Link href="/admin/system-report">System report</Link> to see what is missing.</> : <>, so ask one at the conference office.</>}
        </div>
      )}
      {events.length === 0 && (
        <p className="report-empty">
          No club events are open for visiting clubs right now. To send a link, an event must be published, open to clubs, billed to the church or club, and not over yet. Ask the event administrator to set that up, then come back here.
        </p>
      )}
      <form className={styles.form} noValidate onSubmit={(event) => void send(event)}>
        <label>
          Event
          <select onChange={(event) => setEventId(event.target.value)} required value={eventId}>
            <option value="">Choose an event…</option>
            {events.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <label>
          Director&apos;s email
          <EmailInput autoComplete="off" label="Director's email" onValueChange={setEmail} required value={email} />
        </label>
        <label>
          Name (optional)
          <input autoComplete="off" maxLength={120} onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <button className="primary-button" disabled={busy || !emailConfigured || !eventId || !email.trim()} type="submit">
          <Send aria-hidden="true" size={15} /> {sending ? "Sending…" : "Send link"}
        </button>
      </form>
      {message && <p className={`inline-notice ${message.tone}`} role="status">{message.text}</p>}
      {invites.length === 0 ? (
        <p className="report-empty">No visiting club links have been sent yet.</p>
      ) : (
        <ul className={styles.list}>
          {invites.map((invite) => (
            <li className={styles.row} key={invite.id}>
              <span className={styles.rowText}>
                <strong translate="no">{invite.name || invite.email}</strong>
                <small translate="no">{invite.email}</small>
                <small>{invite.eventName}</small>
              </span>
              <span className={`status-chip ${invite.state === "OPEN" ? "purple" : invite.state === "USED" ? "green" : "neutral"}`}>{stateLabels[invite.state]}</span>
              {invite.state === "OPEN" && (
                <button className="secondary-button" disabled={busy} onClick={() => void withdraw(invite)} type="button">{withdrawingId === invite.id ? "Withdrawing…" : "Withdraw"}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
