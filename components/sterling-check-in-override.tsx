"use client";

import { ShieldAlert } from "lucide-react";
import { useId, useState } from "react";
import { STERLING_CHECK_NEEDED_MESSAGE } from "@/modules/checkin/domain";

/**
 * #874: shown in place of the Check in button when an adult or staff member at
 * a youth or children's event isn't current with Sterling Volunteers. Staff
 * with check-in permission can still check them in by typing a reason (for
 * example "verified current in Sterling portal"); the server audits it. The
 * server enforces the rule either way; this only saves a wasted tap.
 */
export function SterlingCheckInOverride({
  personLabel,
  canOverride,
  disabled = false,
  onOverride,
}: {
  personLabel: string;
  canOverride: boolean;
  disabled?: boolean;
  onOverride: (reason: string) => Promise<{ status: "CONFIRMED" | "QUEUED" | "CONFLICT"; message: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inputId = useId();
  const trimmed = reason.trim();

  async function submit() {
    if (trimmed.length < 3 || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await onOverride(trimmed);
      if (result.status !== "CONFIRMED") setMessage(result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="sterling-check-in-override">
      <small className="status-chip coral">
        <ShieldAlert aria-hidden="true" size={12} /> {STERLING_CHECK_NEEDED_MESSAGE}
      </small>
      {canOverride && !open && (
        <button className="secondary-button" disabled={disabled} onClick={() => setOpen(true)} type="button">
          Override
        </button>
      )}
      {canOverride && open && (
        <span className="sterling-check-in-override-form">
          <label htmlFor={inputId}>
            Reason for checking in <span translate="no">{personLabel}</span>
          </label>
          <input
            autoComplete="off"
            disabled={busy}
            id={inputId}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. verified current in Sterling portal"
            value={reason}
          />
          <button className="primary-button" disabled={disabled || busy || trimmed.length < 3} onClick={() => void submit()} type="button">
            {busy ? "Saving…" : "Check in with override"}
          </button>
          <button className="secondary-button" disabled={busy} onClick={() => { setOpen(false); setReason(""); setMessage(""); }} type="button">
            Cancel
          </button>
        </span>
      )}
      {message && <small className="inline-notice error" role="alert">{message}</small>}
    </span>
  );
}
