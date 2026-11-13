"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FormMessage, notSavedMessage } from "@/components/form-message";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote, SortableHeader, useAddressSort } from "@/components/list-sort";
import { SearchClearButton } from "@/components/search-clear-button";
import { SearchResultStatus, useClientSearch, useSearchTicket } from "@/components/search-as-you-type";
import { cardCell } from "@/components/table-card-labels";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { sortOrderText, sortRows, type SortState } from "@/lib/list-sort";
import { paginate } from "@/lib/pagination";
import {
  describeItemCounts,
  recognitionItemLabels,
  recognitionItems,
  type RecognitionDefinition,
  type RecognitionItemValue,
  type RecognitionSearchPage,
  type RecognitionSummary,
} from "@/modules/recognitions/domain";
import styles from "@/components/recognitions-workspace.module.css";

type State = { definitions: RecognitionDefinition[]; summary: RecognitionSummary };
type Message = { tone: "success" | "error"; text: string } | null;
type ClubRow = RecognitionSummary["perClub"][number];

const itemName = (item: RecognitionItemValue) => recognitionItemLabels[item].singular;

const CLUB_COLUMNS = ["club", "pins", "patches", "stars", "total"] as const;
type ClubColumn = (typeof CLUB_COLUMNS)[number];
const CLUB_DEFAULT_SORT: SortState<ClubColumn> = { key: "club", dir: "asc" };
const clubAccessors: Record<ClubColumn, (club: ClubRow) => string | number> = {
  club: (club) => club.clubName,
  pins: (club) => club.counts.PIN,
  patches: (club) => club.counts.PATCH,
  stars: (club) => club.counts.STAR,
  total: (club) => club.total,
};
const clubSortWords: Record<ClubColumn, string> = { club: "club name", pins: "pins", patches: "patches", stars: "stars", total: "total marks" };
const HANDOUT_PAGE_SIZE = 20;

/**
 * Event recognitions (#1683): find an attendee by name (or page through everyone), mark or undo a recognition, and read the
 * totals and the per-club hand-out list. The server decides who may do each step and checks it again on every call.
 */
export function RecognitionsWorkspace({ eventId, initial, canDefine }: { eventId: string; initial: State; canDefine: boolean }) {
  const base = `/api/events/${encodeURIComponent(eventId)}/recognitions`;
  const [state, setState] = useState(initial);
  const find = useClientSearch();
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<RecognitionSearchPage | null>(null);
  const [listError, setListError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [markMessage, setMarkMessage] = useState<Message>(null);
  const [defineMessage, setDefineMessage] = useState<Message>(null);
  const [name, setName] = useState("");
  const [item, setItem] = useState<RecognitionItemValue>("PIN");
  const [handOutPage, setHandOutPage] = useState(1);
  const ticket = useSearchTicket();
  const clubSort = useAddressSort(CLUB_COLUMNS, CLUB_DEFAULT_SORT);
  const active = state.definitions.filter((definition) => definition.isActive);
  useUnsavedChangesGuard(name.trim() !== "" && busyKey !== "define");

  const term = find.term.trim();
  useEffect(() => {
    const mine = ticket.next();
    fetch(`${base}/attendees?q=${encodeURIComponent(term)}&page=${page}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as Partial<RecognitionSearchPage> & { message?: string };
        if (!ticket.isCurrent(mine)) return;
        if (!response.ok || !body.results) { setListError(body.message ?? "The list could not be loaded. Try again."); return; }
        setListError("");
        setResults(body as RecognitionSearchPage);
      })
      .catch(() => { if (ticket.isCurrent(mine)) setListError("Check your connection and try again."); });
  }, [term, page, base, ticket]);

  async function reload() {
    const response = await fetch(base, { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as { definitions: RecognitionDefinition[]; summary: RecognitionSummary };
      setState({ definitions: body.definitions, summary: body.summary });
    }
  }

  async function change(attendeeId: string, recognition: RecognitionDefinition, mark: boolean, who: string) {
    setBusyKey(`${attendeeId}:${recognition.id}`);
    setMarkMessage(null);
    try {
      const response = await fetch(`${base}/marks`, { method: mark ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attendeeId, recognitionId: recognition.id }) });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setMarkMessage({ tone: "error", text: notSavedMessage(body.message ?? "Try again.") }); return; }
      setResults((current) => current && {
        ...current,
        results: current.results.map((row) => row.attendeeId !== attendeeId ? row : {
          ...row,
          earnedRecognitionIds: mark ? [...row.earnedRecognitionIds, recognition.id] : row.earnedRecognitionIds.filter((id) => id !== recognition.id),
        }),
      });
      setMarkMessage({ tone: "success", text: mark ? `Marked ${who}: ${recognition.name}.` : `Undid ${recognition.name} for ${who}.` });
      await reload();
    } catch {
      setMarkMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setBusyKey(null);
    }
  }

  async function define(event: React.FormEvent) {
    event.preventDefault();
    setBusyKey("define");
    setDefineMessage(null);
    try {
      const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, item }) });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setDefineMessage({ tone: "error", text: notSavedMessage(body.message ?? "Try again.") }); return; }
      setName("");
      setDefineMessage({ tone: "success", text: "Saved. The recognition can be marked now." });
      await reload();
    } catch {
      setDefineMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setBusyKey(null);
    }
  }

  const { summary } = state;
  const sortedClubs = useMemo(() => sortRows(summary.perClub, clubSort.key, clubSort.dir, clubAccessors), [summary.perClub, clubSort.key, clubSort.dir]);
  const handOut = paginate(summary.handOut, handOutPage, HANDOUT_PAGE_SIZE);
  const shown = results?.results ?? [];

  return (
    <div className={styles.stack}>
      <section className="panel page-stack" aria-labelledby="recognitions-mark-heading">
        <h2 id="recognitions-mark-heading">Mark a recognition</h2>
        {active.length === 0 ? (
          <p className={styles.muted}>{canDefine ? "Add a recognition below first." : "No recognitions are listed for this event yet. Ask an event administrator to add them."}</p>
        ) : (
          <>
            <div>
              <label className="search-field">
                <Search aria-hidden="true" size={18} />
                <span className="sr-only">Find a person by name</span>
                <input {...find.inputProps} autoComplete="off" onChange={(event) => { find.inputProps.onChange(event); setPage(1); }} placeholder="Find a person by name" />
                <SearchClearButton onClear={() => { find.setValue(""); setPage(1); }} visible={find.value !== ""} />
              </label>
              <SearchResultStatus message={results ? `${results.total} ${results.total === 1 ? "person" : "people"} listed.` : ""} />
            </div>
            {listError && <FormMessage message={listError} tone="error" />}
            {results !== null && shown.length === 0 && <p className={styles.muted}>{term ? "No one on this event matches that name. Clear the search to see everyone." : "No one is registered with a club for this event yet."}</p>}
            {shown.length > 0 && (
              <ul className={styles.list} data-testid="recognition-results">
                {shown.map((row) => (
                  <li className={styles.card} key={row.attendeeId}>
                    <div className={styles.cardHead}><strong translate="no">{row.name}</strong><span className={styles.club} translate="no">{row.clubName}</span></div>
                    <div className={styles.actions}>
                      {active.map((recognition) => {
                        const earned = row.earnedRecognitionIds.includes(recognition.id);
                        const working = busyKey === `${row.attendeeId}:${recognition.id}`;
                        return (
                          <button aria-label={`${earned ? "Undo" : "Mark"} ${recognition.name} (${itemName(recognition.item)}) for ${row.name}`} className={earned ? "secondary-button" : "primary-button"} disabled={busyKey !== null} key={recognition.id} onClick={() => change(row.attendeeId, recognition, !earned, row.name)} type="button">
                            {working ? "Saving…" : earned ? `Undo ${recognition.name}` : `${recognition.name} (${itemName(recognition.item)})`}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {results && <ListPager label="People pages" noun="people" nounOne="person" onPage={setPage} slice={results} />}
          </>
        )}
        <FormMessage alwaysMounted message={markMessage?.text ?? ""} tone={markMessage?.tone ?? "success"} />
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
              <input autoComplete="off" id="recognition-name" maxLength={60} onChange={(event) => { setName(event.target.value); setDefineMessage(null); }} required value={name} />
            </label>
            <label className={styles.field} htmlFor="recognition-item">What it earns
              <select id="recognition-item" onChange={(event) => setItem(event.target.value as RecognitionItemValue)} value={item}>
                {recognitionItems.map((value) => <option key={value} value={value}>{recognitionItemLabels[value].singular}</option>)}
              </select>
            </label>
            <button className="primary-button" disabled={busyKey === "define" || name.trim().length < 2} type="submit">{busyKey === "define" ? "Saving…" : "Add recognition"}</button>
            <FormMessage alwaysMounted message={defineMessage?.text ?? ""} tone={defineMessage?.tone ?? "success"} />
          </form>
        </section>
      )}

      <section className="panel page-stack" aria-labelledby="recognitions-totals-heading">
        <h2 id="recognitions-totals-heading">Totals</h2>
        <p data-testid="recognition-item-totals">{describeItemCounts(summary.perItem)}</p>
        {summary.perRecognition.length > 0 && (
          <div className="report-table-wrap">
            <table className="report-table table-cards" role="table">
              <caption className="sr-only">Marks per recognition</caption>
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Recognition</th><th role="columnheader" scope="col">Earns</th><th role="columnheader" scope="col">Marked</th></tr></thead>
              <tbody role="rowgroup">{summary.perRecognition.map((row) => <tr key={row.id} role="row"><th role="rowheader" scope="row">{row.name}</th><td {...cardCell("Earns")}>{itemName(row.item)}</td><td {...cardCell("Marked")}>{row.count}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {sortedClubs.length > 0 && (
          <>
            {clubSort.key && <SortOrderNote>{sortOrderText(clubSortWords[clubSort.key], clubSort.dir, clubSort.key === "club" ? "text" : "number")}</SortOrderNote>}
            <div className="report-table-wrap">
              <table className="report-table table-cards" role="table">
                <caption className="sr-only">Marks per club</caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <SortableHeader active={clubSort.key === "club"} direction={clubSort.dir} label="Club" onSort={() => clubSort.toggle("club", "asc")} />
                    <SortableHeader active={clubSort.key === "pins"} direction={clubSort.dir} label="Pins" onSort={() => clubSort.toggle("pins", "desc")} />
                    <SortableHeader active={clubSort.key === "patches"} direction={clubSort.dir} label="Patches" onSort={() => clubSort.toggle("patches", "desc")} />
                    <SortableHeader active={clubSort.key === "stars"} direction={clubSort.dir} label="Stars" onSort={() => clubSort.toggle("stars", "desc")} />
                    <SortableHeader active={clubSort.key === "total"} direction={clubSort.dir} label="Total" onSort={() => clubSort.toggle("total", "desc")} />
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {sortedClubs.map((club) => (
                    <tr key={club.clubKey} role="row">
                      <th role="rowheader" scope="row" translate="no">{club.clubName}</th>
                      <td {...cardCell("Pins")}>{club.counts.PIN}</td>
                      <td {...cardCell("Patches")}>{club.counts.PATCH}</td>
                      <td {...cardCell("Stars")}>{club.counts.STAR}</td>
                      <td {...cardCell("Total")}>{club.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel page-stack" aria-labelledby="recognitions-handout-heading">
        <h2 id="recognitions-handout-heading">Hand-out list by club</h2>
        {summary.handOut.length === 0 && <p className={styles.muted}>No one has been marked yet.</p>}
        <ul className={styles.list} data-testid="recognition-handout">
          {handOut.items.map((club) => (
            <li className={styles.card} key={club.clubKey}>
              <strong translate="no">{club.clubName}</strong>
              <ul className={styles.names}>{club.people.map((person) => <li key={person.attendeeId}><span translate="no">{person.name}</span>: {person.earned.join(", ")}</li>)}</ul>
            </li>
          ))}
        </ul>
        <ListPager label="Hand-out pages" noun="clubs" nounOne="club" onPage={setHandOutPage} slice={handOut} />
      </section>
    </div>
  );
}
