"use client";

import { useEffect, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { centralScheduleLabel } from "@/modules/events/content-schedule";
import styles from "@/components/event-page-publishing.module.css";

type Status = { active: boolean; expiresAt: string | null };

/**
 * The private preview link of an event page (#1514). The link is shown once, when it is made: only its hash is kept, so
 * a lost link is replaced rather than looked up. Making a new one turns the old one off.
 */
export function EventPagePreviewLinkPanel({ eventId, dirty }: { eventId: string; dirty: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}/content/preview-link`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled && body) setStatus({ active: Boolean(body.active), expiresAt: body.expiresAt ?? null }); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [eventId]);

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/events/${eventId}/content/preview-link`, { method });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "The preview link could not be updated.");
      if (method === "POST") {
        setUrl(body.url);
        setStatus({ active: true, expiresAt: body.expiresAt });
      } else {
        setUrl("");
        setStatus({ active: false, expiresAt: null });
        setNotice("The preview link is turned off.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The preview link could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Link copied.");
    } catch {
      setNotice("Select the link and copy it.");
    }
  }

  return (
    <section className="panel" id="event-content-preview-link" aria-labelledby="event-content-preview-title">
      <div className={styles.panelHead}>
        <h2 id="event-content-preview-title">Preview link</h2>
        <p>
          Share a private link that shows this page with its unpublished sections. Anyone with the link can see it until it
          expires or you turn it off. The preview shows what is saved{dirty ? ", so save your changes first" : ""}.
        </p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {url && (
        <div className={styles.linkRow}>
          <input readOnly value={url} aria-label="Preview link" onFocus={(event) => event.currentTarget.select()} />
          <button className="secondary-button" type="button" onClick={() => void copy()}>
            <Copy size={15} aria-hidden="true" /> Copy link
          </button>
        </div>
      )}
      {url && <p className={styles.hint}>This is the only time the link is shown. Copy it now.</p>}
      <p className={styles.hint} aria-live="polite">
        {status === null
          ? "Checking the preview link…"
          : status.active && status.expiresAt
            ? `A preview link is on. It expires ${centralScheduleLabel(status.expiresAt)}.`
            : "No preview link is on."}
      </p>
      <div className={styles.actions}>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void call("POST")}>
          <Link2 size={15} aria-hidden="true" /> {status?.active ? "Make a new link (turns off the old one)" : "Make a preview link"}
        </button>
        {status?.active && (
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void call("DELETE")}>
            Turn off the link
          </button>
        )}
      </div>
    </section>
  );
}
