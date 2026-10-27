"use client";

import { SITE_UPDATING_MESSAGE } from "@/lib/submit-json";

/**
 * Shown when a submit could not reach the site, usually because it is restarting (#1263). The form
 * above keeps every value; "Try again" re-runs the same submit with the same values and the same
 * idempotency key, so a request that did arrive is never applied twice.
 */
export function SubmitRetryNotice({
  onRetry,
  busy = false,
  message = SITE_UPDATING_MESSAGE,
  className,
}: {
  onRetry: () => void;
  busy?: boolean;
  message?: string;
  className?: string;
}) {
  return (
    <div className={["submit-retry-notice", className].filter(Boolean).join(" ")} role="alert" aria-live="assertive">
      <span>{message}</span>
      <button type="button" className="secondary-button" onClick={onRetry} disabled={busy} aria-busy={busy}>
        {busy ? "Trying again…" : "Try again"}
      </button>
    </div>
  );
}
