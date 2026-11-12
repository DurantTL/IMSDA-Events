"use client";

import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { BAPTISM_MAX_LEAD_EMAILS } from "@/modules/baptism-follow-up/domain";
import styles from "@/components/baptism-follow-up.module.css";

/** The event lead addresses for baptism notices (#1680). The server decides who may save and checks every address. */
export function BaptismFollowUpPanel({ endpoint, initialEmails }: { endpoint: string; initialEmails: string[] }) {
  const [saved, setSaved] = useState(initialEmails);
  const [text, setText] = useState(initialEmails.join("\n"));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const dirty = text.trim() !== saved.join("\n");
  useUnsavedChangesGuard(dirty && !busy, "You have unsaved event lead addresses. Leave this page and discard them?");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadEmails: text }) });
      const result = await response.json().catch(() => ({})) as { leadEmails?: string[]; message?: string };
      if (!response.ok || !result.leadEmails) {
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "Try Save again.") });
        return;
      }
      setSaved(result.leadEmails);
      setText(result.leadEmails.join("\n"));
      setMessage({ tone: "success", text: savedMessage(result.leadEmails.length === 0 ? "No notices will be sent until you add an address." : "") });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.panel} data-testid="baptism-follow-up-panel" noValidate onSubmit={save}>
      <label className={styles.field} htmlFor="baptism-lead-emails">
        Event lead email addresses
        <textarea aria-describedby="baptism-lead-emails-help" autoComplete="off" disabled={busy} id="baptism-lead-emails" onChange={(event) => setText(event.target.value)} rows={4} spellCheck={false} value={text} />
        <span className={styles.help} id="baptism-lead-emails-help">One per line, up to {BAPTISM_MAX_LEAD_EMAILS}. Nothing is sent until at least one is saved.</span>
      </label>
      <div className={styles.row}>
        <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save addresses"}</button>
      </div>
      {message && <FormMessage message={message.text} tone={message.tone} />}
    </form>
  );
}
