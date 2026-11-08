"use client";

import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { teacherRuleSummary, defaultTeacherRule, type TeacherRule } from "@/modules/club-teachers/domain";
import styles from "@/components/club-teachers-panel.module.css";

type State = { enabled: boolean; rule: TeacherRule | null };

/**
 * The Club teachers switch and rule (#1681), for an Area Coordinator (in the coordinator portal) and for staff (More).
 * Same panel, different endpoint: the server decides who may use each. Off hides the step for clubs and keeps the data.
 */
export function ClubTeachersPanel({ endpoint, initial }: { endpoint: string; initial: State }) {
  const [state, setState] = useState(initial);
  const start = initial.rule ?? defaultTeacherRule;
  const [base, setBase] = useState(String(start.baseTeachers));
  const [larger, setLarger] = useState(start.largerClubOver !== null);
  const [over, setOver] = useState(String(start.largerClubOver ?? 10));
  const [largerCount, setLargerCount] = useState(String(start.largerClubTeachers));
  const [require, setRequire] = useState(start.requireTeachers);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function send(body: object, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { state?: State; message?: string };
      if (!response.ok || !result.state) {
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "Try Save again.") });
        return;
      }
      setState(result.state);
      setMessage({ tone: "ok", text: savedMessage(done) });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setBusy(false);
    }
  }

  function saveRule(event: React.FormEvent) {
    event.preventDefault();
    void send({
      rule: {
        baseTeachers: Number(base),
        largerClubOver: larger ? Number(over) : null,
        largerClubTeachers: larger ? Number(largerCount) : Number(base),
        requireTeachers: require,
      },
    }, "");
  }

  const visible = state.enabled && state.rule !== null;
  return (
    <div className={styles.panel} data-testid="club-teachers-panel">
      <div className={styles.row}>
        <p className={styles.state} role="status">
          Club teachers is {state.enabled ? "on" : "off"}.{" "}
          {visible
            ? `Clubs are asked for ${teacherRuleSummary(state.rule!)}.`
            : state.enabled ? "Clubs see nothing until you save a rule." : "Clubs see nothing."}
        </p>
        <button className="secondary-button" disabled={busy} onClick={() => send({ enabled: !state.enabled }, state.enabled ? "Turned off. Teachers clubs already named are kept." : "Turned on.")} type="button">
          {state.enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      <form className={styles.form} onSubmit={saveRule}>
        <label className={styles.field}>
          Teachers asked of every club
          <input disabled={busy} inputMode="numeric" max={20} min={0} onChange={(event) => setBase(event.target.value)} required type="number" value={base} />
        </label>
        <label className={styles.check}>
          <input checked={larger} disabled={busy} onChange={(event) => setLarger(event.target.checked)} type="checkbox" />
          Ask larger clubs for more teachers
        </label>
        {larger && (
          <>
            <label className={styles.field}>
              A club is larger when it brings more than this many people
              <input disabled={busy} inputMode="numeric" max={20} min={1} onChange={(event) => setOver(event.target.value)} required type="number" value={over} />
            </label>
            <label className={styles.field}>
              Teachers asked of a larger club
              <input disabled={busy} inputMode="numeric" max={20} min={0} onChange={(event) => setLargerCount(event.target.value)} required type="number" value={largerCount} />
            </label>
          </>
        )}
        <label className={styles.check}>
          <input checked={require} disabled={busy} onChange={(event) => setRequire(event.target.checked)} type="checkbox" />
          Require it: a club below its number cannot submit
        </label>
        <p className={styles.help}>Off, a club below its number sees a warning and can still register.</p>
        <div className={styles.row}>
          <button className="primary-button" disabled={busy} type="submit">Save rule</button>
        </div>
      </form>
      {message && <FormMessage message={message.text} tone={message.tone === "ok" ? "success" : "error"} />}
    </div>
  );
}
