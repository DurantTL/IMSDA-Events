"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import styles from "./monthly-record-reminders.module.css";

/**
 * The on/off switch shared by the Monthly Record reminder (#1895) and Area Coordinator review (#1701): the state line, one
 * button that reads "Saving…" while the change is made, and one message after it. `children` are the notes under the
 * button. The route checks access again.
 */
export function MonthlyRecordSwitch({
  endpoint,
  enabled,
  stateText,
  buttonSuffix,
  savedOn,
  savedOff,
  stateTestId,
  children,
}: {
  endpoint: string;
  enabled: boolean;
  stateText: string;
  /** Read by screen readers after "Turn on" / "Turn off". */
  buttonSuffix: string;
  savedOn: string;
  savedOff: string;
  stateTestId: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function change(next: boolean) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "The change could not be saved.") });
        return;
      }
      setMessage({ tone: "success", text: savedMessage(next ? savedOn : savedOff) });
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
        <span className={styles.state} data-testid={stateTestId}>{stateText}</span>
        <button aria-busy={saving || undefined} className={enabled ? "secondary-button" : "primary-button"} disabled={saving} onClick={() => void change(!enabled)} type="button">
          {saving ? "Saving…" : enabled ? "Turn off" : "Turn on"}
          <span className="sr-only">{buttonSuffix}</span>
        </button>
      </div>
      {children}
      <FormMessage alwaysMounted message={message?.text ?? ""} tone={message?.tone ?? "success"} />
    </div>
  );
}
