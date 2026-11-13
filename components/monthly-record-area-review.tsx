"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import styles from "./monthly-record-item-review.module.css";

/**
 * The conference switch for Area Coordinator review of Monthly Records (#1701), for Clubs Administrators and system
 * administrators. Off by default. The route checks access again.
 */
export function MonthlyRecordAreaReview({ clubYear, enabled }: { clubYear: string; enabled: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function change(next: boolean) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/club-reports/monthly-area-review", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "The change could not be saved.") });
        return;
      }
      setMessage({ tone: "success", text: savedMessage(next ? `Area Coordinator review is on for ${clubYear}.` : `Area Coordinator review is off for ${clubYear}.`) });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="monthly-area-review-heading" className={styles.card} data-testid="monthly-record-area-review" id="monthly-record-area-review">
      <h2 className={styles.heading} id="monthly-area-review-heading">Area Coordinator review</h2>
      <p className={styles.help}>
        Optional. When on, an Area Coordinator can mark each item of a submitted Monthly Record OK or Returned with a note. A club with a returned item can change it and submit again, even after the due date. Staff review works the same either way.
      </p>
      <div className={styles.switchBlock}>
        <div className={styles.switchRow}>
          <span className={styles.state} data-testid="area-review-state">{enabled ? `Area Coordinator review is on for ${clubYear}.` : `Area Coordinator review is off for ${clubYear}.`}</span>
          <button aria-busy={saving || undefined} className={enabled ? "secondary-button" : "primary-button"} disabled={saving} onClick={() => void change(!enabled)} type="button">
            {saving ? "Saving…" : enabled ? "Turn off" : "Turn on"}
            <span className="sr-only">{` Area Coordinator review for ${clubYear}`}</span>
          </button>
        </div>
        <p className={styles.help}>This applies to {clubYear} only.</p>
        <FormMessage alwaysMounted message={message?.text ?? ""} tone={message?.tone ?? "success"} />
      </div>
    </section>
  );
}
