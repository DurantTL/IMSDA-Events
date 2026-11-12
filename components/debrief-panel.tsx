"use client";

import Link from "next/link";
import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import styles from "@/components/debrief-panel.module.css";

type State = { enabled: boolean; evaluationEnabled: boolean; fillPath: string | null };
type Busy = null | "toggle" | "evaluation";

/**
 * The Debrief switch (#1679), for an Area Coordinator (in the coordinator portal) and for staff (More). Same panel, different
 * endpoint: the server decides who may use each. Off stops the emails that are not sent yet and keeps the questions and answers.
 * `canChooseEvaluation` is staff only: the director evaluation goes to club directors, so a coordinator does not see its switch.
 */
export function DebriefPanel({ canChooseEvaluation, endpoint, initial }: { canChooseEvaluation: boolean; endpoint: string; initial: State }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function send(body: object, kind: Exclude<Busy, null>, done: string) {
    setBusy(kind);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { state?: State; message?: string };
      if (!response.ok || !result.state) {
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "Try again.") });
        return;
      }
      setState(result.state);
      setMessage({ tone: "success", text: savedMessage(done) });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.panel} data-testid="debrief-panel">
      <div className={styles.row}>
        <p className={styles.state} role="status">
          The debrief is {state.enabled ? "on" : "off"}.{" "}
          {state.enabled ? "The event's staff and the Area Coordinators are emailed the morning after the event, and once more three days later if they have not answered." : "Nobody is emailed."}
        </p>
        <button className="secondary-button" disabled={busy !== null} onClick={() => send({ enabled: !state.enabled }, "toggle", state.enabled ? "Turned off. Emails not yet sent are stopped; the questions and answers are kept." : "Turned on.")} type="button">
          {busy === "toggle" ? "Saving…" : state.enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      {state.enabled && state.fillPath && (
        <p className={styles.help}>
          <Link href={state.fillPath}>Open the debrief form</Link> to answer it yourself. You will be asked to sign in.
        </p>
      )}
      {canChooseEvaluation && state.enabled && (
        <>
          <label className={styles.check}>
            <input checked={state.evaluationEnabled} disabled={busy !== null} onChange={(event) => void send({ evaluationEnabled: event.target.checked }, "evaluation", event.target.checked ? "The club director evaluation is on." : "The club director evaluation is off.")} type="checkbox" />
            Also ask club directors for a short evaluation
          </label>
          <p className={styles.help}>It goes to the director and deputy of each club registered for the event, in the same emails. Off by default.</p>
        </>
      )}
      {message && <FormMessage message={message.text} tone={message.tone} />}
    </div>
  );
}
