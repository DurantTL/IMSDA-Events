"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, notSavedMessage } from "@/components/form-message";
import styles from "@/components/baptism-follow-up.module.css";

/** Turns Baptism follow-up on or off for the event (#1680). The server decides who may, and off keeps every name, status and note. */
export function BaptismFollowUpSwitch({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
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
    <div className={styles.switch}>
      {enabled && <p className={styles.muted}>Turning Baptism follow-up off hides this page and sends no notices. Every name, status and note is kept.</p>}
      <button className={enabled ? "secondary-button" : "primary-button"} disabled={busy} onClick={change} type="button">{busy ? "Saving…" : enabled ? "Turn Baptism follow-up off" : "Turn Baptism follow-up on"}</button>
      <FormMessage alwaysMounted message={error} tone="error" />
    </div>
  );
}
