"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "@/components/staff-club-applications.module.css";
import type { NewClubInviteRecord } from "@/modules/club-applications/repository";

const inviteStateLabels = { OPEN: "Not used yet", USED: "Used", CANCELLED: "Cancelled", EXPIRED: "Expired" } as const;

/**
 * The Private links view of the staff applications queue (#817, #1589): email a prospective director a private link to the
 * application, and the links sent so far with Withdraw for the unused ones. Same routes and checks as before.
 */
export function StaffPrivateLinks({ invites, emailConfigured }: { invites: NewClubInviteRecord[]; emailConfigured: boolean }) {
  const router = useRouter();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ text: string; tone: "error" | "success" } | null>(null);
  const { confirm: askConfirm, confirmDialog } = useConfirm();

  // Typed values not yet sent (#1468).
  useUnsavedChangesGuard(
    inviteEmail.trim() !== "" || inviteName.trim() !== "",
    "You have typed something here that has not been sent. Leave this page and discard it?",
  );

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    setInviteBusy(true);
    setInviteMessage(null);
    try {
      const response = await fetch("/api/admin/club-applications/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, name: inviteName }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The link could not be sent.");
      setInviteMessage({ text: `A private link was emailed to ${inviteEmail.trim().toLowerCase()}.`, tone: "success" });
      setInviteEmail("");
      setInviteName("");
      router.refresh();
    } catch (caught) {
      setInviteMessage({ text: caught instanceof Error ? caught.message : "The link could not be sent.", tone: "error" });
    } finally {
      setInviteBusy(false);
    }
  }

  async function withdrawInvite(invite: NewClubInviteRecord) {
    if (!(await askConfirm({
      title: `Withdraw the link sent to ${invite.email}`,
      body: <p>The link stops working right away. The club can&apos;t use it to apply, and you can send a new one.</p>,
      confirmLabel: `Withdraw link for ${invite.email}`,
      destructive: true,
    }))) return;
    setInviteBusy(true);
    setInviteMessage(null);
    try {
      const response = await fetch(`/api/admin/club-applications/invites/${encodeURIComponent(invite.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The link could not be withdrawn.");
      router.refresh();
    } catch (caught) {
      setInviteMessage({ text: caught instanceof Error ? caught.message : "The link could not be withdrawn.", tone: "error" });
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div className="panel">
      {confirmDialog}
      <div className="section-heading"><div><h2>Send a private link</h2></div></div>
      <p className="field-help">
        Email a prospective director a private link to the application. It opens the same form with their email filled in, works once, and creates nothing until you approve it.
      </p>
      {!emailConfigured && <div className="inline-notice error" role="status">Account email isn&apos;t set up on this server, so links can&apos;t be sent yet.</div>}
      <form className="nca-invite-form" onSubmit={(event) => void sendInvite(event)}>
        <label>
          Director&apos;s email
          <input autoComplete="off" onChange={(event) => setInviteEmail(event.target.value)} required type="email" value={inviteEmail} />
        </label>
        <label>
          Name (optional)
          <input autoComplete="off" maxLength={120} onChange={(event) => setInviteName(event.target.value)} value={inviteName} />
        </label>
        <button className="primary-button" disabled={inviteBusy || !emailConfigured || !inviteEmail.trim()} type="submit">
          <Send aria-hidden="true" size={15} /> Send link
        </button>
      </form>
      {inviteMessage && <p className={`inline-notice ${inviteMessage.tone}`} role="status">{inviteMessage.text}</p>}
      {invites.length === 0 ? (
        <p className="report-empty">No private links have been sent yet.</p>
      ) : (
        <ul className={`club-invite-list ${styles.linkList}`}>
          {invites.map((invite) => (
            <li key={invite.id}>
              <span><strong translate="no">{invite.name || invite.email}</strong><small translate="no">{invite.email}</small></span>
              <span className={`status-chip ${invite.state === "OPEN" ? "purple" : invite.state === "USED" ? "green" : "neutral"}`}>{inviteStateLabels[invite.state]}</span>
              {invite.state === "OPEN" && (
                <button className="secondary-button" disabled={inviteBusy} onClick={() => void withdrawInvite(invite)} type="button">Withdraw</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
