"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import styles from "@/components/event-staffing-panel.module.css";

type State = { enabled: boolean };

/**
 * The Event staffing switch (#1678), for an Area Coordinator (in the coordinator portal) and for staff (More). Same panel,
 * different endpoint: the server decides who may use each. Off hides the sheet and keeps every activity and assignment.
 */
export function EventStaffingPanel({ endpoint, initial }: { endpoint: string; initial: State }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !state.enabled }) });
      const result = await response.json().catch(() => ({})) as { state?: State; message?: string };
      if (!response.ok || !result.state) {
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "Try again.") });
        return;
      }
      setState(result.state);
      router.refresh();
      setMessage({ tone: "success", text: savedMessage(state.enabled ? "Turned off. The activities and people you entered are kept." : "Turned on.") });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.panel} data-testid="event-staffing-panel">
      <div className={styles.row}>
        <p className={styles.state} role="status">Event staffing is {state.enabled ? "on" : "off"}.</p>
        <button className="secondary-button" disabled={busy} onClick={() => void toggle()} type="button">
          {busy ? "Saving…" : state.enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      {message && <FormMessage message={message.text} tone={message.tone} />}
    </div>
  );
}
