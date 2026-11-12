"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, notSavedMessage } from "@/components/form-message";
import styles from "@/components/recognitions-workspace.module.css";

/** Turns Recognitions on or off for the event (#1683). The server decides who may, and off keeps every mark. */
export function RecognitionsSwitch({ eventId, enabled }: { eventId: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/recognitions/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(notSavedMessage(body.message ?? "Try again.")); return; }
      router.refresh();
    } catch {
      setError(notSavedMessage("Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.form}>
      {enabled && <p className={styles.help}>Turning Recognitions off hides this page. Everything already marked is kept.</p>}
      <button className={enabled ? "secondary-button" : "primary-button"} disabled={busy} onClick={change} type="button">{enabled ? "Turn Recognitions off" : "Turn Recognitions on"}</button>
      <FormMessage alwaysMounted message={error} tone="error" />
    </div>
  );
}
