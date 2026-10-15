"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Prepares or refreshes the DRAFT invoice for one church's promo codes (#399). The server checks MANAGE_FINANCE for the
 * event again; hiding or disabling this is never the protection. It only prepares a draft: the office finalizes and sends
 * the invoice from the invoice screen, which needs the Finalize invoices permission.
 */
export function ChurchDraftControl({ eventId, churchId, label, disabled }: { eventId: string; churchId: string; label: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/church-code-invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ churchId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "The draft could not be prepared.");
      const outcome = String(result.outcome ?? "");
      setNotice(
        outcome === "CREATED" ? "Draft created."
          : outcome === "REFRESHED" ? "Draft refreshed."
            : outcome === "REVISION_STARTED" ? "Revision draft started."
              : "Already up to date.",
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The draft could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="billing-inline-action">
      <button className="secondary-button" disabled={busy || disabled} onClick={() => void run()} type="button">
        {busy ? "Working…" : label}
      </button>
      {notice && <small role="status">{notice}</small>}
      {error && <small className="form-error" role="alert">{error}</small>}
    </span>
  );
}
