"use client";

import { useState } from "react";
import { CloudOff } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { clockTime, useLimitExpiry } from "./tester-format";
import styles from "./page.module.css";

type Message = { tone: "ok" | "bad" | "warn"; text: string };

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
        setLimitedUntil(body.nextAllowedAt);
        setMessage({ tone: "warn", text: `${body.message ?? "Limit reached."} You can try again at ${clockTime(body.nextAllowedAt, false)}.` });
        setOpen(false);
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
        {configured ? (
          message && <span className={message.tone === "ok" ? styles.purgeOk : styles.purgeBad} role="status">{message.text}</span>
        ) : (
          <span className={styles.purgeBad}>
            <CloudOff aria-hidden="true" size={14} /> Not set up. Add <code>CLOUDFLARE_PURGE_WEBHOOK_URL</code> in the xCloud settings.
          </span>
        )}
      </div>
      {configured && (
        <button className="secondary-button" type="button" onClick={() => { setError(""); setMessage(null); setOpen(true); }} disabled={limitedUntil !== null}>
          Clear Cloudflare cache
        </button>
      )}
      <ConfirmDialog
        busy={busy}
        busyLabel="Clearing…"
        confirmLabel="Clear cache"
        error={error}
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
