"use client";

import { useState } from "react";
import { FormErrorSummary, summaryMessage, useFormErrorSummary, type ErrorSummaryItem } from "@/components/form-error-summary";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { teacherRuleSummary, defaultTeacherRule, type TeacherRule } from "@/modules/club-teachers/domain";
import styles from "@/components/club-teachers-panel.module.css";

type State = { enabled: boolean; rule: TeacherRule | null };
type Busy = null | "toggle" | "rule";

const ids = { base: "club-teachers-base", over: "club-teachers-over", larger: "club-teachers-larger" };

const whole = (value: string) => value.trim() !== "" && Number.isInteger(Number(value));

/**
 * The Club teachers switch and rule (#1681), for an Area Coordinator (in the coordinator portal) and for staff (More).
 * Same panel, different endpoint: the server decides who may use each. Off hides the step for clubs and keeps the data.
 * `canRequire` is staff only: a coordinator sees whether "require" is on, read only, and cannot change it.
 */
export function ClubTeachersPanel({ canRequire, endpoint, initial }: { canRequire: boolean; endpoint: string; initial: State }) {
  const [state, setState] = useState(initial);
  const start = initial.rule ?? defaultTeacherRule;
  const [base, setBase] = useState(String(start.baseTeachers));
  const [larger, setLarger] = useState(start.largerClubOver !== null);
  const [over, setOver] = useState(String(start.largerClubOver ?? 10));
  const [largerCount, setLargerCount] = useState(String(start.largerClubTeachers));
  const [require, setRequire] = useState(start.requireTeachers);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();

  // Dirty: the form differs from the rule last saved (or from the defaults when none is saved yet).
  const saved = state.rule ?? defaultTeacherRule;
  const dirty = base !== String(saved.baseTeachers)
    || larger !== (saved.largerClubOver !== null)
    || (larger && (over !== String(saved.largerClubOver ?? 10) || largerCount !== String(saved.largerClubTeachers)))
    || (canRequire && require !== saved.requireTeachers);
  useUnsavedChangesGuard(dirty && busy === null, "You have an unsaved teacher rule. Leave this page and discard it?");

  async function send(body: object, kind: Exclude<Busy, null>, done: string) {
    setBusy(kind);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { state?: State; message?: string };
      if (!response.ok || !result.state) {
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "Try Save again.") });
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

  function problems(): Record<string, string> {
    const found: Record<string, string> = {};
    if (!whole(base) || Number(base) < 0 || Number(base) > 20) found[ids.base] = "Enter a whole number from 0 to 20.";
    if (larger) {
      if (!whole(over) || Number(over) < 1 || Number(over) > 20) found[ids.over] = "Enter a whole number from 1 to 20.";
      if (!whole(largerCount) || Number(largerCount) < 0 || Number(largerCount) > 20) found[ids.larger] = "Enter a whole number from 0 to 20.";
      else if (whole(base) && Number(largerCount) < Number(base)) found[ids.larger] = "A larger club is asked for at least as many teachers as any club.";
    }
    return found;
  }

  const labels: Record<string, string> = { [ids.base]: "Teachers asked of every club", [ids.over]: "Larger club size", [ids.larger]: "Teachers asked of a larger club" };

  function saveRule(event: React.FormEvent) {
    event.preventDefault();
    const found = problems();
    setFieldErrors(found);
    if (Object.keys(found).length > 0) {
      showSummary(Object.entries(found).map(([targetId, text]): ErrorSummaryItem => ({ targetId, message: summaryMessage(labels[targetId]!, text) })));
      return;
    }
    clearSummary();
    void send({
      rule: {
        baseTeachers: Number(base),
        largerClubOver: larger ? Number(over) : null,
        largerClubTeachers: larger ? Number(largerCount) : Number(base),
        // A coordinator's request never asks to block; the server ignores it and refuses a true.
        requireTeachers: canRequire ? require : false,
      },
    }, "rule", "");
  }

  function field(id: string, label: string, value: string, set: (value: string) => void, min: number) {
    const error = fieldErrors[id];
    return (
      <label className={styles.field} htmlFor={id}>
        {label}
        <input aria-describedby={error ? `${id}-error` : undefined} aria-invalid={error ? true : undefined} disabled={busy !== null} id={id} inputMode="numeric" max={20} min={min} onChange={(event) => set(event.target.value)} type="number" value={value} />
        {error && <span className={styles.error} id={`${id}-error`}>{error}</span>}
      </label>
    );
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
        <button className="secondary-button" disabled={busy !== null} onClick={() => send({ enabled: !state.enabled }, "toggle", state.enabled ? "Turned off. Teachers clubs already named are kept." : "Turned on.")} type="button">
          {busy === "toggle" ? "Saving…" : state.enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      <form className={styles.form} noValidate onChange={(event) => { clearSummaryField((event.target as HTMLElement).id); setFieldErrors((current) => { const next = { ...current }; delete next[(event.target as HTMLElement).id]; return next; }); }} onSubmit={saveRule}>
        {summaryItems.length > 0 && <FormErrorSummary items={summaryItems} ref={summaryRef} />}
        {field(ids.base, labels[ids.base]!, base, setBase, 0)}
        <label className={styles.check}>
          <input checked={larger} disabled={busy !== null} onChange={(event) => setLarger(event.target.checked)} type="checkbox" />
          Ask larger clubs for more teachers
        </label>
        {larger && (
          <>
            {field(ids.over, "A club is larger when it brings more than this many people", over, setOver, 1)}
            {field(ids.larger, labels[ids.larger]!, largerCount, setLargerCount, 0)}
          </>
        )}
        {canRequire ? (
          <>
            <label className={styles.check}>
              <input checked={require} disabled={busy !== null} onChange={(event) => setRequire(event.target.checked)} type="checkbox" />
              Require it: a club below its number cannot submit
            </label>
            <p className={styles.help}>Off, a club below its number sees a warning and can still register.</p>
          </>
        ) : (
          <p className={styles.help}>
            Required before a club can submit: <strong>{saved.requireTeachers ? "Yes" : "No"}</strong>. Only the Clubs Administrator or event staff can change this. Otherwise a club below its number sees a warning and can still register.
          </p>
        )}
        <div className={styles.row}>
          <button className="primary-button" disabled={busy !== null} type="submit">{busy === "rule" ? "Saving…" : "Save rule"}</button>
        </div>
      </form>
      {message && <FormMessage message={message.text} tone={message.tone} />}
    </div>
  );
}
