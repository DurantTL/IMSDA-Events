"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import styles from "./monthly-record-reminders.module.css";

/**
 * The on/off switch of the automatic Monthly Record reminder (#1895). The button reads "Saving…" while the change is
 * being made and one message follows it. The route checks access again.
 */
export function MonthlyRecordReminderSwitch({ clubYear, enabled, started, turnOnNote }: { clubYear: string; enabled: boolean; started: boolean; turnOnNote: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function change(next: boolean) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/club-reports/monthly-reminders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "The change could not be saved.") });
        return;
      }
      setMessage({ tone: "success", text: savedMessage(next ? `Reminders are on for ${clubYear}.` : `Reminders are off for ${clubYear}. Nothing will be sent until you turn them back on.`) });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.switchBlock}>
      <div className={styles.switchRow}>
        <span className={styles.state} data-testid="reminder-state">{enabled ? `Reminders are on for ${clubYear}.` : started ? `Reminders are off for ${clubYear}.` : "Reminders are off. They haven't been turned on yet."}</span>
        <button aria-busy={saving || undefined} className={enabled ? "secondary-button" : "primary-button"} disabled={saving} onClick={() => void change(!enabled)} type="button">
          {saving ? "Saving…" : enabled ? "Turn off" : "Turn on"}
          <span className="sr-only">{` the Monthly Record reminders for ${clubYear}`}</span>
        </button>
      </div>
      {!enabled && turnOnNote && <p className={styles.note}>{turnOnNote}</p>}
      {enabled && <p className={styles.note}>Turning off applies to {clubYear} only. Once started, each new club year starts on.</p>}
      <FormMessage alwaysMounted message={message?.text ?? ""} tone={message?.tone ?? "success"} />
    </div>
  );
}
