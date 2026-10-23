"use client";

import { useState } from "react";
import { MailX } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { suppressionExplanation, suppressionLabel } from "@/modules/communications/suppression-labels";
import type { SuppressionSummary, SuppressedAddressRow } from "@/modules/communications/email-suppression";

const failedMessage = "The address could not be re-enabled.";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Email health > Not sending (#863): addresses that got a permanent bounce or a spam complaint, so no email of any kind
 * goes to them. A system administrator can re-enable one (audited, with who and when). The server checks the role and the
 * request origin on every request; nothing here is the protection.
 */
export function SuppressedAddressesPanel({ initial }: { initial: SuppressionSummary }) {
  const [summary, setSummary] = useState(initial);
  const [pending, setPending] = useState<SuppressedAddressRow | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/email/suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suppressionId: pending.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.rows)) {
        throw new Error(typeof result.message === "string" ? result.message : failedMessage);
      }
      setSummary({ total: Number(result.total) || 0, rows: result.rows });
      setNotice("Email to that address is switched back on. A new bounce or complaint would stop it again.");
      setPending(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failedMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3 id="email-not-sending"><MailX aria-hidden="true" size={16} /> Not sending</h3>
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {summary.total === 0 ? (
        <p className="quiet-copy" data-health="no-suppressed">No address is blocked because of a bounce or a spam complaint.</p>
      ) : (
        <>
          <p className="quiet-copy" data-health="suppressed-count">
            {summary.total} {summary.total === 1 ? "address is" : "addresses are"} not being sent to
            {summary.total > summary.rows.length ? `; the newest ${summary.rows.length} are listed` : ""}. A hard bounce or a spam complaint stops all email to an address, confirmations and receipts included.
          </p>
          <ul className="notification-event-list" aria-labelledby="email-not-sending">
            {summary.rows.map((row) => (
              <li data-suppressed-address={row.id} key={row.id}>
                <span>
                  <strong translate="no">{row.address}</strong>
                  <small className="quiet-copy">{suppressionLabel(row.reason)} since {formatDate(row.suppressedAt)}. {suppressionExplanation(row.reason)}</small>
                </span>
                <button className="secondary-button" onClick={() => { setError(""); setPending(row); }} type="button">Re-enable</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <ConfirmDialog
        busy={busy}
        busyLabel="Re-enabling…"
        confirmLabel="Re-enable email"
        error={error}
        onCancel={() => { setPending(null); setError(""); }}
        onConfirm={confirm}
        open={pending !== null}
        title="Re-enable email to this address?"
      >
        {pending && (
          <>
            <p><strong translate="no">{pending.address}</strong></p>
            <p>{suppressionLabel(pending.reason)}. Only re-enable it when the owner has fixed the problem (a corrected mailbox, or the person asks to hear from us again). If it bounces or is reported as spam again, it stops again. This is recorded with your name and the time.</p>
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
