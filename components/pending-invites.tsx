"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyApplicationLink } from "@/components/copy-application-link";
import { useConfirm } from "@/components/use-confirm";
import type { PendingInvite } from "@/modules/system-admin/pending-invites";
import styles from "./people-directory.module.css";

async function post(url: string, init: { method: string; json: unknown }, fallback: string) {
  const response = await fetch(url, { method: init.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.json) });
  const result = await response.json().catch(() => ({})) as { message?: string; setupUrl?: string; setupExpiresAt?: string };
  if (!response.ok) throw new Error(result.message ?? fallback);
  return result;
}

const cancelCopy: Record<PendingInvite["kind"], string> = {
  staff: "Their sign-in is switched off and the activation link stops working. Any roles and event assignments made with the invite are kept; \"Allow sign-in\" on their page undoes this.",
  club: "The invite can no longer be accepted. Nothing else changes.",
  area: "The invite can no longer be accepted. Nothing else changes.",
};

/**
 * Invites still waiting on the person (#1276), with Resend and Cancel. Used above the People list and on a person's
 * page. Each action calls the route that already owns that kind of invite; the server decides who may.
 */
export function PendingInvites({ invites, emailConfigured, heading = "Pending invites" }: {
  invites: readonly PendingInvite[];
  emailConfigured: boolean;
  heading?: string;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);

  if (invites.length === 0) return null;

  async function run(invite: PendingInvite, work: () => Promise<string>, fallback: string) {
    setBusy(invite.id);
    setMessage("");
    setError("");
    setLink(null);
    try {
      setMessage(await work());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  async function resend(invite: PendingInvite) {
    await run(invite, async () => {
      if (invite.kind === "club") {
        const result = await post("/api/admin/club-invites/send", { method: "POST", json: { inviteIds: [invite.id] } }, "The invite could not be sent.");
        return result.message ?? "Invite sent again.";
      }
      if (invite.kind === "area") {
        return (await post(`/api/admin/area-coordinator-invites/${encodeURIComponent(invite.id)}`, { method: "POST", json: { action: "resend" } }, "The invite could not be sent.")).message ?? "Invite sent again.";
      }
      const result = await post(`/api/admin/users/${encodeURIComponent(invite.id)}/actions`, { method: "POST", json: { action: "resend-invite" } }, "The invite could not be sent.");
      if (result.setupUrl) setLink({ id: invite.id, url: result.setupUrl });
      return result.message ?? "Invite sent again.";
    }, "The invite could not be sent.");
  }

  async function cancel(invite: PendingInvite) {
    const who = invite.name || invite.email;
    if (!(await confirm({
      title: `Cancel the invite for ${who}?`,
      body: <p>{cancelCopy[invite.kind]}</p>,
      confirmLabel: `Cancel invite for ${who}`,
      cancelLabel: "Keep invite",
      destructive: true,
    }))) return;
    await run(invite, async () => {
      if (invite.kind === "club") {
        await post(`/api/admin/club-invites/${encodeURIComponent(invite.id)}`, { method: "PATCH", json: { cancel: true } }, "The invite could not be cancelled.");
        return "Invite cancelled.";
      }
      if (invite.kind === "area") {
        await post(`/api/admin/area-coordinator-invites/${encodeURIComponent(invite.id)}`, { method: "POST", json: { action: "cancel" } }, "The invite could not be cancelled.");
        return "Invite cancelled.";
      }
      const result = await post(`/api/admin/users/${encodeURIComponent(invite.id)}/actions`, { method: "POST", json: { action: "cancel-invite" } }, "The invite could not be cancelled.");
      return result.message ?? "Invite cancelled.";
    }, "The invite could not be cancelled.");
  }

  return (
    <section aria-labelledby="pending-invites-heading" className={styles.box}>
      {confirmDialog}
      <h2 id="pending-invites-heading">{heading}</h2>
      <ul className={styles.pendingList}>
        {invites.map((invite) => {
          const who = invite.name || invite.email;
          // A family-side invite carries no secret, so without email staff pass the sign-up link on themselves.
          const copyInstead = !emailConfigured && invite.kind !== "staff" && invite.signUpUrl;
          return (
            <li className={styles.pendingRow} key={`${invite.kind}-${invite.id}`}>
              <strong translate="no">{who}</strong>
              {invite.name ? <small translate="no">{invite.email}</small> : null}
              <p>{invite.what}</p>
              <p className={invite.expired ? styles.fieldError : styles.note}>
                {invite.expired ? "Expired" : invite.sentAt ? `Sent ${new Date(invite.sentAt).toLocaleDateString("en-US", { timeZone: "UTC" })}` : "Not sent yet"}
              </p>
              <div className={styles.pendingActions}>
                {copyInstead ? (
                  <p className={styles.note}>Account email isn&apos;t set up, so this invite can&apos;t be emailed. Give them the sign-up link instead.</p>
                ) : (
                  <button aria-label={`Resend invite to ${who}`} className="secondary-button" disabled={busy !== null} onClick={() => void resend(invite)} type="button">
                    {invite.kind === "staff" && !emailConfigured ? "Get a new setup link" : "Resend"}
                  </button>
                )}
                <button aria-label={`Cancel invite for ${who}`} className="secondary-button" disabled={busy !== null} onClick={() => void cancel(invite)} type="button">Cancel invite</button>
              </div>
              {copyInstead ? <CopyApplicationLink label="Copy sign-up link" noun="sign-up link" url={invite.signUpUrl!} /> : null}
              {link?.id === invite.id ? <CopyApplicationLink label="Copy setup link" noun="setup link" url={link.url} /> : null}
            </li>
          );
        })}
      </ul>
      <div className={styles.status}>
        <p aria-live="polite" role="status">{message}</p>
        {error ? <p className={styles.statusError} role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
