"use client";

import { EventSetupHelp } from "@/components/event-setup-help";
import { useConfirm } from "@/components/use-confirm";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Ban, Pencil, Send } from "lucide-react";
import type { ClubInviteRecord } from "@/modules/club-imports/invites";
import type { StatusWord } from "@/modules/registrations/status-words";
import { clubDirectorRoleLabels } from "@/modules/organizations/director-grants-domain";
import styles from "./club-invites-workspace.module.css";
import { conferenceDateFormat } from "@/modules/calendar/conference-format";

type InvitesResponse = { sent?: number; message?: string; issues?: Array<{ message?: string }> };

const statusLabels = { PENDING: "Draft", SENT: "Sent", ACCEPTED: "Confirmed", CANCELLED: "Cancelled" } as const satisfies Record<ClubInviteRecord["status"], StatusWord | "Sent">;
const statusTone = { PENDING: "gold", SENT: "purple", ACCEPTED: "green", CANCELLED: "coral" } as const;

function formatDate(value: string | null) {
  return value ? conferenceDateFormat({ dateStyle: "medium" }).format(new Date(value)) : "";
}

/**
 * The invite rows of Club leaders (#376, #1589), for the Invited and Draft views. Nothing here sends on its own: each Send
 * button is the administrator's decision to email those people. The actions call the same routes as the old Club invites
 * page; after each one the server list is read again, so the page always shows what is stored.
 * `drafts` are the Send buttons' scopes: every unsent invite, and the picked club's own (the routes send by club, not by role).
 */
export function ClubInvitesWorkspace({
  invites,
  emailConfigured,
  status,
  drafts,
  club,
  emptyText,
  draftHref = "/admin/clubs/leaders?status=draft",
}: {
  invites: ClubInviteRecord[];
  emailConfigured: boolean;
  status: "invited" | "draft";
  drafts: { all: number; club: number | null };
  /** The one club the list is narrowed to, for its own Send button. */
  club: { id: string; name: string } | null;
  /** What the list says when nothing is in it. The workspace stays mounted then, so a notice about the last action still shows. */
  emptyText: string;
  /** The Draft view with the club and role filters the list has now. */
  draftHref?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<ReactNode>("");

  async function call(url: string, method: string, body: unknown, success: (result: InvitesResponse) => ReactNode) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as InvitesResponse;
      if (!response.ok) throw new Error(result.message ?? result.issues?.[0]?.message ?? "The invites could not be updated.");
      setNotice(success(result));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invites could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const sentMessage = (result: InvitesResponse) => `Sent ${result.sent ?? 0} invite${result.sent === 1 ? "" : "s"}.`;

  async function send(selection: { organizationId?: string; inviteIds?: string[] }, count: number, label: string) {
    if (!(await askConfirm({
      title: `Email ${count} invite${count === 1 ? "" : "s"}`,
      body: <p>{`${count} invite${count === 1 ? "" : "s"} will be emailed ${label} now. Emails can't be recalled once sent.`}</p>,
      confirmLabel: `Email ${count} invite${count === 1 ? "" : "s"}`,
    }))) return;
    void call("/api/admin/club-invites/send", "POST", selection, sentMessage);
  }

  async function changeEmail(invite: ClubInviteRecord) {
    const email = await ask({
      title: `Change email for ${invite.name || "this invite"}?`,
      body: <p>{`The invite to ${invite.club.name} will be sent to the new address instead.`}</p>,
      confirmLabel: "Change email",
      input: { label: `New email for ${invite.name || "this invite"} (${invite.club.name})`, defaultValue: invite.email, type: "email", required: true },
    });
    if (!email || email.trim().toLowerCase() === invite.email) return;
    void call(`/api/admin/club-invites/${encodeURIComponent(invite.id)}`, "PATCH", { email }, () => <>Email changed. The invite is waiting to be sent in the <Link href={draftHref}>Draft view</Link>.</>);
  }

  async function cancel(invite: ClubInviteRecord) {
    if (!(await askConfirm({
      title: `Cancel the invite for ${invite.name || invite.email}`,
      body: <p>{`The invite to ${invite.club.name} is cancelled and its link stops working.`}</p>,
      confirmLabel: `Cancel invite for ${invite.name || invite.email}`,
      destructive: true,
    }))) return;
    void call(`/api/admin/club-invites/${encodeURIComponent(invite.id)}`, "PATCH", { cancel: true }, () => "Invite cancelled.");
  }

  const { confirm: askConfirm, ask, confirmDialog } = useConfirm();
  return (
    <div className={styles.wrap}>
      {confirmDialog}
      {status === "draft" && (
        <p className={styles.bulk}>
          <button
            className="primary-button"
            disabled={busy || drafts.all === 0 || !emailConfigured}
            onClick={() => send({}, drafts.all, "to every club with an unsent invite")}
            type="button"
          >
            <Send aria-hidden="true" size={16} /> Send all unsent ({drafts.all})
          </button>
          {club && drafts.club !== null && (
            <button
              className="secondary-button"
              disabled={busy || drafts.club === 0 || !emailConfigured}
              onClick={() => send({ organizationId: club.id }, drafts.club ?? 0, `for ${club.name}, every role`)}
              type="button"
            >
              <Send aria-hidden="true" size={14} /> Send all unsent for <span translate="no">{club.name}</span>, every role ({drafts.club})
            </button>
          )}
        </p>
      )}
      {!emailConfigured && (
        <div className="inline-notice error" role="status">Account email isn&apos;t set up on this server, so invites can&apos;t be sent yet.</div>
      )}
      {!emailConfigured && (
        <EventSetupHelp context="club invites" id="club-invites-email" />
      )}
      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {error && <div className="inline-notice error" role="alert">{error}</div>}

      {invites.length === 0 && (
        <>
          <p className={styles.empty} role="status">{emptyText}</p>
          <EventSetupHelp context="club invites" id="club-invites-none" />
        </>
      )}

      {invites.length > 0 && <ul className={styles.list}>
        {invites.map((invite) => (
          <li className={styles.row} key={invite.id}>
            <span className={styles.who}>
              <strong translate="no">{invite.name || invite.email}</strong>
              {invite.name ? <small translate="no">{invite.email}</small> : null}
              <span className={styles.where}>
                <span translate="no">{invite.club.name}</span> · {clubDirectorRoleLabels[invite.role]}{" "}
                <span className={`status-chip ${statusTone[invite.status]}`}>
                  {statusLabels[invite.status]}
                  {invite.status === "SENT" && invite.sentAt ? ` · ${formatDate(invite.sentAt)}` : ""}
                </span>
                {invite.expired && invite.expiresAt ? <>{" "}<span className="status-chip coral">Expired · {formatDate(invite.expiresAt)}</span></> : null}
                {!invite.club.isActive && <span className={styles.inactive}> · Inactive club: invites can&apos;t be sent.</span>}
              </span>
            </span>
            {(invite.status === "PENDING" || invite.status === "SENT") && (
              <span className={styles.actions}>
                {invite.status === "SENT" && (
                  <button className="secondary-button" disabled={busy || !emailConfigured} onClick={() => send({ inviteIds: [invite.id] }, 1, `again to ${invite.email}`)} type="button">
                    <Send aria-hidden="true" size={13} /> Resend
                  </button>
                )}
                <button aria-label={`Change email for ${invite.name || invite.email}`} className="secondary-button" disabled={busy} onClick={() => changeEmail(invite)} type="button">
                  <Pencil aria-hidden="true" size={13} />
                </button>
                <button aria-label={`Cancel invite for ${invite.name || invite.email}`} className="secondary-button" disabled={busy} onClick={() => cancel(invite)} type="button">
                  <Ban aria-hidden="true" size={13} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>}
    </div>
  );
}
