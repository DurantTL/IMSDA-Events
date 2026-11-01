"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SetupHelpPanel } from "@/components/setup-help";
import { systemSetupFor } from "@/modules/setup-help/system-setup-steps";
import { clockTime, useLimitExpiry } from "./tester-format";
import styles from "./page.module.css";

type Message = { tone: "ok" | "bad"; text: string };

/**
 * "Clear Cloudflare cache" (#1429), in the System report's Security and setup section. Only a yes/no "configured" comes
 * from the server: the webhook address never reaches the browser. The server decides everything; this only asks, shows
 * the fixed words it answers with, and keeps the button off while the hourly limit holds.
 */
export function CloudflarePurgeRow({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [limitedUntil, setLimitedUntil] = useState<string | null>(null);
  useLimitExpiry(limitedUntil, () => setLimitedUntil(null));

  // The limit text shows whenever the limit holds, including when the dialog is reopened, so a disabled Confirm always has a reason.
  const limitText = limitedUntil ? `Limit reached: 3 cache clears an hour. You can try again at ${clockTime(limitedUntil, false)}.` : "";

  // After a limit answer Confirm is disabled, so move focus to Cancel (the dialog's other button) rather than leave it on a dead control.
  useEffect(() => {
    if (!open || !limitedUntil || busy) return;
    const cancel = document.querySelector<HTMLElement>('[role="dialog"] .form-actions .secondary-button');
    cancel?.focus();
  }, [open, limitedUntil, busy]);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/system-report/cloudflare-purge", { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { state?: string; message?: string; nextAllowedAt?: string };
      if (response.ok && body.state === "purged") {
        setMessage({ tone: "ok", text: body.message ?? "Cloudflare cache cleared." });
        setOpen(false);
      } else if (response.status === 429 && body.nextAllowedAt) {
        // Keep the dialog open; the limit text is shown by `limitText` and focus moves to Cancel (effect above).
        setLimitedUntil(body.nextAllowedAt);
      } else {
        setError(body.message ?? "The cache could not be cleared. Try again.");
      }
    } catch {
      setError("The cache could not be cleared. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.purgeRow} data-testid="cloudflare-purge" data-state={configured ? "ready" : "not-configured"}>
      <div className={styles.purgeText}>
        <strong>Clear Cloudflare cache</strong>
        <span>Clears every cached file for events.imsda.org. An emergency tool, not a routine one.</span>
        {!configured && (
          <span className={styles.purgeBad}>
            <CloudOff aria-hidden="true" size={14} /> Not set up. Add <code>CLOUDFLARE_PURGE_WEBHOOK_URL</code> in the xCloud settings.
          </span>
        )}
        {!configured && <SetupHelpPanel setup={systemSetupFor("cloudflare-purge")} context="Clear Cloudflare cache" />}
        <span aria-live="polite" className={message?.tone === "ok" ? styles.purgeOk : styles.purgeBad}>{configured && message ? message.text : ""}</span>
      </div>
      {configured && (
        <button className="secondary-button" type="button" onClick={() => { setError(""); setMessage(null); setOpen(true); }}>
          Clear Cloudflare cache
        </button>
      )}
      <ConfirmDialog
        busy={busy}
        busyLabel="Clearing…"
        confirmDisabled={limitedUntil !== null}
        confirmLabel="Clear cache"
        error={error || limitText}
        onCancel={() => setOpen(false)}
        onConfirm={confirm}
        open={open}
        title="Clear Cloudflare cache?"
      >
        <p>This clears every cached file for events.imsda.org. Pages may load a little slower for a few minutes.</p>
      </ConfirmDialog>
    </div>
  );
}
