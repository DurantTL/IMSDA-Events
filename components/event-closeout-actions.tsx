"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useConfirm } from "@/components/use-confirm";
import styles from "@/components/event-closeout.module.css";

type Props = {
  eventId: string;
  eventName: string;
  lifecycleVersion: number;
  /** "sign-off" while the event is in Financial reconciliation, "reopen" while it is Closed. */
  mode: "sign-off" | "reopen";
  blocking: number;
  warnings: number;
  /** The open checks the page shows ("id:state:count:cents"); the server refuses the sign-off when its own set differs. */
  seenOpenChecks: readonly string[];
  noteMaxLength: number;
  reasonMaxLength: number;
};

type Outcome = { tone: "success" | "error"; message: string } | null;

/** The sign-off form and the reopen form (#1515). The server re-reads the checklist; nothing here decides anything. */
export function EventCloseoutActions({ eventId, eventName, lifecycleVersion, mode, blocking, warnings, seenOpenChecks, noteMaxLength, reasonMaxLength }: Props) {
  const router = useRouter();
  const { confirm, ask, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);
  // A typed note or a ticked box is unsaved until the sign-off goes through (rule B6).
  useUnsavedChangesGuard(mode === "sign-off" && (note.trim() !== "" || acknowledged));

  async function send(path: string, body: Record<string, unknown>, success: string) {
    setBusy(true);
    setOutcome(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/closeout/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setOutcome({ tone: "error", message: notSavedMessage(data?.message ?? "The server did not answer. Nothing was changed; try again.") });
        // A changed checklist or event state: show the current list, and ask for the warnings tick again.
        if (response.status === 409) {
          setAcknowledged(false);
          router.refresh();
        }
        return;
      }
      setNote("");
      setAcknowledged(false);
      setOutcome({ tone: "success", message: savedMessage(success) });
      router.refresh();
    } catch {
      setOutcome({ tone: "error", message: notSavedMessage("The server did not answer. Nothing was changed; try again.") });
    } finally {
      setBusy(false);
    }
  }

  async function signOff(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const confirmed = await confirm({
      title: `Sign off and close ${eventName}`,
      body: "Your name and this checklist are recorded, and the event moves to Closed. A finance admin can reopen it later with a reason.",
      confirmLabel: `Sign off and close ${eventName}`,
    });
    if (!confirmed) return;
    await send("sign-off", { acknowledgeWarnings: acknowledged, note: note.trim() || null, lifecycleVersion, seenOpenChecks }, "The event is closed.");
  }

  async function reopen() {
    if (busy) return;
    const reason = await ask({
      title: `Reopen ${eventName}`,
      body: "The event goes back to Financial reconciliation. The earlier sign-off stays in the history.",
      confirmLabel: `Reopen ${eventName}`,
      input: { label: "Reason", required: true, multiline: true, maxLength: reasonMaxLength, hint: "Say why, without a person's health or contact details." },
    });
    if (reason === null) return;
    await send("reopen", { reason, lifecycleVersion }, "The event is back in Financial reconciliation.");
  }

  if (mode === "reopen") {
    return (
      <div className={styles.form}>
        <div className={styles.actions}>
          <button className="secondary-button" type="button" onClick={reopen} disabled={busy} aria-busy={busy || undefined}>{busy ? "Saving…" : "Reopen this event"}</button>
        </div>
        <FormMessage tone={outcome?.tone ?? "success"} message={outcome?.message ?? ""} />
        {confirmDialog}
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={signOff}>
      {blocking > 0 ? <p className={styles.note}>Sign-off is off until the blocking checks above are settled.</p> : null}
      {warnings > 0 && blocking === 0 ? (
        <label className={styles.tick}>
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>I have reviewed the {warnings === 1 ? "warning" : `${warnings} warnings`} above and want to close the event anyway.</span>
        </label>
      ) : null}
      <label className={styles.field}>
        Note (optional)
        <textarea maxLength={noteMaxLength} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className={styles.actions}>
        <button className="primary-button" type="submit" disabled={busy || blocking > 0 || (warnings > 0 && !acknowledged)} aria-busy={busy || undefined}>{busy ? "Saving…" : "Sign off and close"}</button>
      </div>
      <FormMessage tone={outcome?.tone ?? "success"} message={outcome?.message ?? ""} />
      {confirmDialog}
    </form>
  );
}
