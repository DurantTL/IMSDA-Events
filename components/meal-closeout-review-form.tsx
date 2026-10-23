"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Acknowledge or reopen one closeout exception. It records who reviewed it, when and a note, and nothing else: it
 * posts no charge or credit, issues no refund and changes no price or count. A secondary button, so the page keeps one
 * filled button at most.
 */
export function MealCloseoutReviewForm({
  eventId, exceptionKey, detailDigest, acknowledged, label,
}: { eventId: string; exceptionKey: string; detailDigest: string; acknowledged: boolean; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const id = `review-${exceptionKey.replace(/[^a-z0-9]/gi, "-")}`;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    if (!note) { setMessage({ tone: "error", text: "Add a note saying what you checked." }); return; }
    setBusy(true);
    setMessage({ tone: "ok", text: "Saving…" });
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/meals/closeout-review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exceptionKey, detailDigest, note, status: acknowledged ? "REOPENED" : "ACKNOWLEDGED" }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "That could not be saved. Nothing was changed.");
      setMessage({ tone: "ok", text: acknowledged ? "Reopened." : "Acknowledged." });
      router.refresh();
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "That could not be saved. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  const invalid = message?.tone === "error";
  return (
    <form className="form-stack closeout-review-form" onSubmit={save} noValidate>
      <label htmlFor={`${id}-n`}>Note<span className="sr-only"> for {label}</span>
        <input id={`${id}-n`} name="note" type="text" maxLength={1000} autoComplete="off" aria-invalid={invalid ? true : undefined} aria-describedby={`${id}-msg`} />
      </label>
      <div className="form-actions">
        <button className="secondary-button" type="submit" disabled={busy}>
          {acknowledged ? "Reopen" : "Acknowledge"}<span className="sr-only"> {label}</span>
        </button>
      </div>
      <p className={invalid ? "form-error" : "field-help"} id={`${id}-msg`} role="status" aria-live="polite">{message?.text ?? ""}</p>
    </form>
  );
}
