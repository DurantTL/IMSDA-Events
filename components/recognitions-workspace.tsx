"use client";

import { useEffect, useRef, useState } from "react";
import { FormMessage, notSavedMessage } from "@/components/form-message";
import { describeItemCounts, recognitionItemLabels, recognitionItems, type RecognitionDefinition, type RecognitionItemValue, type RecognitionSearchResult, type RecognitionSummary } from "@/modules/recognitions/domain";
import styles from "@/components/recognitions-workspace.module.css";

type State = { definitions: RecognitionDefinition[]; summary: RecognitionSummary };
type Message = { tone: "success" | "error"; text: string } | null;

const itemName = (item: RecognitionItemValue) => recognitionItemLabels[item].singular;

/**
 * Event recognitions (#1683): search an attendee by name, mark or undo a recognition, and read the totals and the per-club hand-out
 * list. The server decides who may do each step and checks it again on every call.
 */
export function RecognitionsWorkspace({ eventId, initial, canDefine }: { eventId: string; initial: State; canDefine: boolean }) {
  const base = `/api/events/${encodeURIComponent(eventId)}/recognitions`;
  const [state, setState] = useState(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecognitionSearchResult[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [name, setName] = useState("");
  const [item, setItem] = useState<RecognitionItemValue>("PIN");
  const requestId = useRef(0);
  const shown = query.trim().length < 2 ? null : results;
  const active = state.definitions.filter((definition) => definition.isActive);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${base}/attendees?q=${encodeURIComponent(text)}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({})) as { results?: RecognitionSearchResult[]; message?: string };
        if (id !== requestId.current) return;
        if (!response.ok || !body.results) { setMessage({ tone: "error", text: notSavedMessage(body.message ?? "The search could not run. Try again.") }); return; }
        setResults(body.results);
      } catch {
        if (id === requestId.current) setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, base]);

  async function reload() {
    const response = await fetch(base, { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as { definitions: RecognitionDefinition[]; summary: RecognitionSummary };
      setState({ definitions: body.definitions, summary: body.summary });
    }
  }

  async function change(attendeeId: string, recognition: RecognitionDefinition, mark: boolean, who: string) {
    setBusyKey(`${attendeeId}:${recognition.id}`);
    setMessage(null);
    try {
      const response = await fetch(`${base}/marks`, { method: mark ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attendeeId, recognitionId: recognition.id }) });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setMessage({ tone: "error", text: notSavedMessage(body.message ?? "Try again.") }); return; }
      setResults((current) => current?.map((row) => row.attendeeId !== attendeeId ? row : {
        ...row,
        earnedRecognitionIds: mark ? [...row.earnedRecognitionIds, recognition.id] : row.earnedRecognitionIds.filter((id) => id !== recognition.id),
      }) ?? null);
      setMessage({ tone: "success", text: mark ? `Marked ${who}: ${recognition.name}.` : `Undid ${recognition.name} for ${who}.` });
      await reload();
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setBusyKey(null);
    }
  }

  async function define(event: React.FormEvent) {
    event.preventDefault();
    setBusyKey("define");
    setMessage(null);
    try {
      const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, item }) });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setMessage({ tone: "error", text: notSavedMessage(body.message ?? "Try again.") }); return; }
      setName("");
      setMessage({ tone: "success", text: "Saved. The recognition can be marked now." });
      await reload();
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setBusyKey(null);
    }
  }

  const { summary } = state;
  return (
    <div className={styles.stack}>
      <section className="panel page-stack" aria-labelledby="recognitions-mark-heading">
        <h2 id="recognitions-mark-heading">Mark a recognition</h2>
        {active.length === 0 ? (
          <p className={styles.muted}>{canDefine ? "Add a recognition below first." : "No recognitions are listed for this event yet. Ask an event administrator to add them."}</p>
        ) : (
          <>
            <label className={styles.field} htmlFor="recognition-search">
              Search by name
              <input autoComplete="off" id="recognition-search" inputMode="search" onChange={(event) => setQuery(event.target.value)} type="search" value={query} aria-describedby="recognition-search-help" />
              <span className={styles.help} id="recognition-search-help">Type at least 2 letters of a first or last name.</span>
            </label>
            {shown !== null && shown.length === 0 && <p className={styles.muted} role="status">No one on this event matches that name.</p>}
            {shown !== null && shown.length > 0 && (
              <ul className={styles.list} data-testid="recognition-results">
                {shown.map((row) => (
                  <li className={styles.card} key={row.attendeeId}>
                    <div className={styles.cardHead}><strong>{row.name}</strong><span className={styles.club}>{row.clubName}</span></div>
                    <div className={styles.actions}>
                      {active.map((recognition) => {
                        const earned = row.earnedRecognitionIds.includes(recognition.id);
                        return (
                          <button aria-label={`${earned ? "Undo" : "Mark"} ${recognition.name} (${itemName(recognition.item)}) for ${row.name}`} className={earned ? "secondary-button" : "primary-button"} disabled={busyKey === `${row.attendeeId}:${recognition.id}`} key={recognition.id} onClick={() => change(row.attendeeId, recognition, !earned, row.name)} type="button">
                            {earned ? `Undo ${recognition.name}` : `${recognition.name} (${itemName(recognition.item)})`}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <FormMessage alwaysMounted message={message?.text ?? ""} tone={message?.tone ?? "success"} />
      </section>

      {canDefine && (
        <section className="panel page-stack" aria-labelledby="recognitions-define-heading">
          <h2 id="recognitions-define-heading">Recognitions for this event</h2>
          <ul className={styles.list}>
            {state.definitions.map((definition) => <li key={definition.id}>{definition.name} ({itemName(definition.item)}){definition.isActive ? "" : " - off"}</li>)}
            {state.definitions.length === 0 && <li className={styles.muted}>None yet. For example: Memory verses (pin), Read the Bible through (patch).</li>}
          </ul>
          <form className={styles.form} noValidate onSubmit={define}>
            <label className={styles.field} htmlFor="recognition-name">Recognition name
              <input autoComplete="off" id="recognition-name" maxLength={60} onChange={(event) => setName(event.target.value)} required value={name} />
            </label>
            <label className={styles.field} htmlFor="recognition-item">What it earns
              <select id="recognition-item" onChange={(event) => setItem(event.target.value as RecognitionItemValue)} value={item}>
                {recognitionItems.map((value) => <option key={value} value={value}>{recognitionItemLabels[value].singular}</option>)}
              </select>
            </label>
            <button className="primary-button" disabled={busyKey === "define" || name.trim().length < 2} type="submit">Add recognition</button>
          </form>
        </section>
      )}

      <section className="panel page-stack" aria-labelledby="recognitions-totals-heading">
        <h2 id="recognitions-totals-heading">Totals</h2>
        <p data-testid="recognition-item-totals">{describeItemCounts(summary.perItem)}</p>
        {summary.perRecognition.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="sr-only">Marks per recognition</caption>
              <thead><tr><th scope="col">Recognition</th><th scope="col">Earns</th><th scope="col">Marked</th></tr></thead>
              <tbody>{summary.perRecognition.map((row) => <tr key={row.id}><th scope="row">{row.name}</th><td>{itemName(row.item)}</td><td>{row.count}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {summary.perClub.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="sr-only">Marks per club</caption>
              <thead><tr><th scope="col">Club</th><th scope="col">Pins</th><th scope="col">Patches</th><th scope="col">Stars</th></tr></thead>
              <tbody>{summary.perClub.map((club) => <tr key={club.clubKey}><th scope="row">{club.clubName}</th><td>{club.counts.PIN}</td><td>{club.counts.PATCH}</td><td>{club.counts.STAR}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel page-stack" aria-labelledby="recognitions-handout-heading">
        <h2 id="recognitions-handout-heading">Hand-out list by club</h2>
        {summary.handOut.length === 0 && <p className={styles.muted}>No one has been marked yet.</p>}
        <ul className={styles.list} data-testid="recognition-handout">
          {summary.handOut.map((club) => (
            <li className={styles.card} key={club.clubKey}>
              <strong>{club.clubName}</strong>
              <ul className={styles.names}>{club.people.map((person) => <li key={person.attendeeId}>{person.name}: {person.earned.join(", ")}</li>)}</ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
