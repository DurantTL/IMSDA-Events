"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EventScoringResultsView } from "@/components/event-scoring-results-view";
import { FormErrorSummary, summaryMessage, useFormErrorSummary, type ErrorSummaryItem } from "@/components/form-error-summary";
import { SearchClearButton } from "@/components/search-clear-button";
import { SearchResultStatus, useClientSearch } from "@/components/search-as-you-type";
import { useConfirm } from "@/components/use-confirm";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import {
  buildScoredEventDefinition,
  kindLabels,
  parseScoreText,
  ribbonModeLabels,
  ribbonModes,
  ribbonRuleSummary,
  scoreInputText,
  scoreKinds,
  scoreUnits,
  unitLabels,
  type RibbonMode,
  type ScoreKind,
  type ScoreUnit,
  type ScoredEventInput,
} from "@/modules/event-scoring/domain";
import type { EventScoringView } from "@/modules/event-scoring/service";
import styles from "@/components/event-scoring-workspace.module.css";

type Message = { tone: "success" | "error"; text: string };
type Section = "switch" | "publish" | "definition" | "entry";
type BandDraft = { label: string; threshold: string };
type Draft = { id: string | null; name: string; kind: ScoreKind; unit: ScoreUnit; higherWins: boolean; ribbonMode: RibbonMode; ribbonPlaces: number; bands: BandDraft[] };

const blankDraft: Draft = { id: null, name: "", kind: "CLUB", unit: "POINTS", higherWins: true, ribbonMode: "PLACES", ribbonPlaces: 3, bands: [] };

const fieldIds = { name: "scoring-def-name", kind: "scoring-def-kind", unit: "scoring-def-unit", bands: "scoring-def-bands", event: "scoring-score-event", subject: "scoring-score-subject", value: "scoring-score-value" };
const bandId = (index: number, part: "label" | "threshold") => `scoring-band-${index}-${part}`;

/**
 * Camporee scoring (#1676) for an Area Coordinator (coordinator portal) and for staff (More). Same workspace, different
 * endpoint: the server decides who may do each action. Off hides everything but the switch and keeps the data.
 * Works on a phone: single column, 44px controls, native pickers.
 */
export function EventScoringWorkspace({ endpoint, initial }: { endpoint: string; initial: EventScoringView }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Partial<Record<Section, Message>>>({});
  const caps = state.capabilities;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [definitionErrors, setDefinitionErrors] = useState<Record<string, string>>({});
  const { ref: definitionSummaryRef, items: definitionSummaryItems, show: showDefinitionSummary, clear: clearDefinitionSummary, clearField: clearDefinitionSummaryField } = useFormErrorSummary();

  const [scoredEventId, setScoredEventId] = useState(initial.scoredEvents[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState("");
  const find = useClientSearch();
  const { confirm, confirmDialog } = useConfirm();
  const [value, setValue] = useState("");
  const [entryErrors, setEntryErrors] = useState<Record<string, string>>({});
  const { ref: entrySummaryRef, items: entrySummaryItems, show: showEntrySummary, clear: clearEntrySummary } = useFormErrorSummary();

  const selected = state.scoredEvents.find((event) => event.id === scoredEventId) ?? null;

  async function send(body: object, section: Section, busyKey: string, done: string, after?: (next: EventScoringView) => void) {
    setBusy(busyKey);
    setMessages((current) => ({ ...current, [section]: undefined }));
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { state?: EventScoringView; message?: string; field?: string };
      if (!response.ok || !result.state) {
        const text = result.message ?? "Try again.";
        if (result.field && section === "definition") setDefinitionErrors({ [result.field === "kind" ? fieldIds.kind : result.field === "name" ? fieldIds.name : fieldIds.bands]: text });
        if (result.field && section === "entry") setEntryErrors({ [result.field === "subject" ? fieldIds.subject : fieldIds.value]: text });
        setMessages((current) => ({ ...current, [section]: { tone: "error", text: notSavedMessage(text) } }));
        return false;
      }
      setState(result.state);
      setMessages((current) => ({ ...current, [section]: { tone: "success", text: savedMessage(done) } }));
      after?.(result.state);
      return true;
    } catch {
      setMessages((current) => ({ ...current, [section]: { tone: "error", text: notSavedMessage("Check your connection and try again.") } }));
      return false;
    } finally {
      setBusy(null);
    }
  }

  /* ---- scored event definition ---- */

  function startDraft(next: Draft) {
    setDraft(next);
    setDefinitionErrors({});
    clearDefinitionSummary();
    setMessages((current) => ({ ...current, definition: undefined }));
  }

  function editDraft(id: string): Draft | null {
    const found = state.scoredEvents.find((event) => event.id === id);
    if (!found) return null;
    return {
      id: found.id,
      name: found.name,
      kind: found.kind,
      unit: found.unit,
      higherWins: found.higherWins,
      ribbonMode: found.ribbonMode,
      ribbonPlaces: found.ribbonPlaces,
      bands: found.ribbonBands.map((band) => ({ label: band.label, threshold: scoreInputText(found.unit, band.thresholdHundredths) })),
    };
  }

  function draftProblems(current: Draft): Record<string, string> {
    const found: Record<string, string> = {};
    if (current.name.trim() === "") found[fieldIds.name] = "Enter the event's name.";
    const input: ScoredEventInput = {
      name: current.name.trim() || "x",
      kind: current.kind,
      unit: current.unit,
      higherWins: current.higherWins,
      ribbonMode: current.ribbonMode,
      ribbonPlaces: current.ribbonPlaces,
      ribbonBands: current.bands.map((band) => ({ label: band.label.trim(), threshold: band.threshold.trim() })),
    };
    const built = buildScoredEventDefinition(input);
    if (!built.ok) {
      for (const [key, message] of Object.entries(built.problems)) {
        const match = /^ribbonBands\.(\d+)\.threshold$/.exec(key);
        found[match ? bandId(Number(match[1]), "threshold") : fieldIds.bands] = message;
      }
    }
    current.bands.forEach((band, index) => {
      if (current.ribbonMode === "BANDS" && band.label.trim() === "") found[bandId(index, "label")] = "Name each ribbon band.";
    });
    return found;
  }

  const definitionLabels = (id: string) => id === fieldIds.name ? "Event name" : id.startsWith("scoring-band-") ? "Ribbon band" : "Ribbon bands";

  function saveDefinition(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const found = draftProblems(draft);
    setDefinitionErrors(found);
    if (Object.keys(found).length > 0) {
      showDefinitionSummary(Object.entries(found).map(([targetId, text]): ErrorSummaryItem => ({ targetId, message: summaryMessage(definitionLabels(targetId), text) })));
      return;
    }
    clearDefinitionSummary();
    void send({
      action: "saveScoredEvent",
      scoredEvent: {
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name.trim(),
        kind: draft.kind,
        unit: draft.unit,
        higherWins: draft.higherWins,
        ribbonMode: draft.ribbonMode,
        ribbonPlaces: draft.ribbonPlaces,
        ribbonBands: draft.ribbonMode === "BANDS" ? draft.bands.map((band) => ({ label: band.label.trim(), threshold: band.threshold.trim() })) : [],
      },
    }, "definition", "definition", "", (next) => {
      setDraft(null);
      if (!scoredEventId && next.scoredEvents[0]) setScoredEventId(next.scoredEvents[0].id);
    });
  }

  const savedDraft = draft?.id ? editDraft(draft.id) : blankDraft;
  const definitionDirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(savedDraft ?? blankDraft);
  useUnsavedChangesGuard(definitionDirty && busy === null, "You have an unsaved scored event. Leave this page and discard it?");

  function change(patch: Partial<Draft>, id?: string) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    if (id) {
      setDefinitionErrors((current) => { const next = { ...current }; delete next[id]; return next; });
      clearDefinitionSummaryField(id);
    }
  }

  /* ---- score entry ---- */

  const subjects = useMemo(() => {
    if (!selected) return [];
    const needle = find.term.trim().toLowerCase();
    if (selected.kind === "CLUB") {
      return state.clubs.filter((club) => !needle || club.name.toLowerCase().includes(needle)).map((club) => ({ id: club.organizationId, label: club.name }));
    }
    return state.people
      .filter((person) => !needle || person.name.toLowerCase().includes(needle) || person.clubName.toLowerCase().includes(needle))
      .map((person) => ({ id: person.attendeeId, label: `${person.name} (${person.clubName})` }));
  }, [selected, state.clubs, state.people, find.term]);

  const entryFor = (eventId: string, subject: string) => state.entries.find((entry) => entry.scoredEventId === eventId && entry.subjectId === subject);
  const published = state.publishedAt !== null;
  const canEnterNow = caps.canEnter && (!published || caps.canCorrectAfterPublish);

  function pickSubject(id: string) {
    setSubjectId(id);
    setEntryErrors({});
    clearEntrySummary();
    setValue(selected ? entryFor(selected.id, id)?.text ?? "" : "");
  }

  function saveEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const found: Record<string, string> = {};
    if (!subjectId) found[fieldIds.subject] = selected.kind === "CLUB" ? "Choose a club." : "Choose a Pathfinder.";
    const parsed = parseScoreText(selected.unit, value);
    if (!parsed.ok) found[fieldIds.value] = parsed.message;
    setEntryErrors(found);
    if (Object.keys(found).length > 0) {
      showEntrySummary(Object.entries(found).map(([targetId, text]): ErrorSummaryItem => ({ targetId, message: summaryMessage(targetId === fieldIds.subject ? "Entry" : "Score", text) })));
      return;
    }
    clearEntrySummary();
    void send({ action: "saveScore", entry: { scoredEventId: selected.id, subjectId, value: value.trim() } }, "entry", "entry", "", () => {
      setSubjectId("");
      setValue("");
      find.setValue("");
    });
  }

  const entryDirty = value.trim() !== "" && subjectId !== "";
  useUnsavedChangesGuard(entryDirty && busy === null, "You have an unsaved score. Leave this page and discard it?");

  const when = state.publishedAt ? formatInConferenceTime(state.publishedAt, { dateStyle: "medium", timeStyle: "short" }) : null;
  const message = (section: Section) => messages[section] && <FormMessage message={messages[section]!.text} tone={messages[section]!.tone} />;

  return (
    <div className={styles.workspace} data-testid="event-scoring-workspace">
      <section aria-labelledby="scoring-switch" className={styles.section}>
        <h3 className={styles.heading} id="scoring-switch">Camporee scoring is {state.enabled ? "on" : "off"}</h3>
        <div className={styles.row}>
          <p className={styles.state} role="status">
            {state.enabled ? "Scores can be entered now. Clubs see nothing until results are published." : "Clubs see nothing, and scoring is hidden. Anything already entered is kept."}
          </p>
          {caps.canSwitch && (
            <button className="secondary-button" disabled={busy !== null} onClick={() => send({ action: "switch", enabled: !state.enabled }, "switch", "switch", state.enabled ? "Turned off. Scores already entered are kept." : "Turned on.")} type="button">
              {busy === "switch" ? "Saving…" : state.enabled ? "Turn off" : "Turn on"}
            </button>
          )}
        </div>
        {!caps.canSwitch && !state.enabled && <p className={styles.help}>Ask the Clubs Administrator or your event administrator to turn Camporee scoring on.</p>}
        {message("switch")}
      </section>

      {state.enabled && (
        <>
          <section aria-labelledby="scoring-publish" className={styles.section}>
            <h3 className={styles.heading} id="scoring-publish">Results for clubs</h3>
            <div className={styles.row}>
              <p className={styles.state} role="status">
                {published ? `Results were published ${when}. Each club director sees only their own club's results.` : "Results are not published. Club directors see nothing yet. Scores can be corrected freely until you publish."}
              </p>
              {caps.canPublish && (
                <button
                  className={published ? "secondary-button" : "primary-button"}
                  disabled={busy !== null}
                  onClick={async () => {
                    if (published && !(await confirm({ title: "Take results back", body: "Club directors will no longer see their club's results until you publish again. Scores are kept.", confirmLabel: "Take results back", destructive: true }))) return;
                    await send({ action: published ? "unpublish" : "publish" }, "publish", "publish", published ? "Results are hidden from clubs again." : "Directors can now see their club's results.");
                  }}
                  type="button"
                >
                  {busy === "publish" ? "Saving…" : published ? "Take results back" : "Publish results"}
                </button>
              )}
            </div>
            {published && <p className={styles.help}>Changes to a score after publishing are recorded in the audit log.</p>}
            {!caps.canPublish && <p className={styles.help}>Only the Clubs Administrator or event staff can publish results.</p>}
            {message("publish")}
          </section>

          <section aria-labelledby="scoring-events" className={styles.section}>
            <h3 className={styles.heading} id="scoring-events">Scored events</h3>
            {state.scoredEvents.length === 0 ? (
              <p className={styles.help}>No scored events yet.{caps.canDefine ? " Add the first one, such as the canoe race or the telephone verse." : " Ask an Area Coordinator, the Clubs Administrator or your event administrator to add them."}</p>
            ) : (
              <ul className={styles.list}>
                {state.scoredEvents.map((event) => (
                  <li className={styles.item} key={event.id}>
                    <span className={styles.itemText}>
                      <strong translate="no">{event.name}</strong>
                      <span className={styles.muted}>{kindLabels[event.kind]} · {unitLabels[event.unit]} · {event.higherWins ? "Higher wins" : "Lower wins"}</span>
                      <span className={styles.muted}>{ribbonRuleSummary(event)}. {event.scoreCount} {event.scoreCount === 1 ? "score" : "scores"} entered.</span>
                    </span>
                    {caps.canDefine && (!published || caps.canCorrectAfterPublish) && (
                      <span className={styles.actions}>
                        <button className="secondary-button" disabled={busy !== null} onClick={() => startDraft(editDraft(event.id)!)} type="button">Edit<span className="sr-only">: {event.name}</span></button>
                        <button className="secondary-button" disabled={busy !== null || published} onClick={async () => {
                          const scores = `${event.scoreCount} ${event.scoreCount === 1 ? "score" : "scores"}`;
                          if (!(await confirm({ title: `Remove ${event.name}`, body: `This deletes the scored event and its ${scores}. This can't be undone.`, confirmLabel: `Remove ${event.name}`, destructive: true }))) return;
                          await send({ action: "deleteScoredEvent", id: event.id }, "definition", `delete-${event.id}`, "Removed.", (next) => setScoredEventId((current) => (current === event.id ? next.scoredEvents[0]?.id ?? "" : current)));
                        }} type="button">
                          {busy === `delete-${event.id}` ? "Saving…" : "Remove"}<span className="sr-only">: {event.name}</span>
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {caps.canDefine && (!published || caps.canCorrectAfterPublish) && !draft && <div className={styles.actions}><button className="secondary-button" disabled={busy !== null} onClick={() => startDraft(blankDraft)} type="button">Add a scored event</button></div>}
            {published && caps.canDefine && caps.canCorrectAfterPublish && state.scoredEvents.length > 0 && <p className={styles.help}>To remove a scored event, take results back first. Changes to a scored event after publishing are recorded in the audit log.</p>}
            {published && caps.canDefine && !caps.canCorrectAfterPublish && <p className={styles.help}>Results are published, so only the Clubs Administrator or event staff can change a scored event now.</p>}
            {draft && (
              <form className={styles.form} noValidate onSubmit={saveDefinition}>
                {definitionSummaryItems.length > 0 && <FormErrorSummary items={definitionSummaryItems} ref={definitionSummaryRef} />}
                <label className={styles.field} htmlFor={fieldIds.name}>
                  Event name
                  <input aria-describedby={definitionErrors[fieldIds.name] ? `${fieldIds.name}-error` : undefined} aria-invalid={definitionErrors[fieldIds.name] ? true : undefined} disabled={busy !== null} id={fieldIds.name} maxLength={80} onChange={(event) => change({ name: event.target.value }, fieldIds.name)} type="text" value={draft.name} />
                  {definitionErrors[fieldIds.name] && <span className={styles.error} id={`${fieldIds.name}-error`}>{definitionErrors[fieldIds.name]}</span>}
                </label>
                <label className={styles.field} htmlFor={fieldIds.kind}>
                  Who is scored
                  <select aria-describedby={definitionErrors[fieldIds.kind] ? `${fieldIds.kind}-error` : undefined} aria-invalid={definitionErrors[fieldIds.kind] ? true : undefined} disabled={busy !== null} id={fieldIds.kind} onChange={(event) => change({ kind: event.target.value as ScoreKind }, fieldIds.kind)} value={draft.kind}>
                    {scoreKinds.map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
                  </select>
                  {definitionErrors[fieldIds.kind] && <span className={styles.error} id={`${fieldIds.kind}-error`}>{definitionErrors[fieldIds.kind]}</span>}
                </label>
                <label className={styles.field} htmlFor={fieldIds.unit}>
                  Unit
                  <select disabled={busy !== null} id={fieldIds.unit} onChange={(event) => change({ unit: event.target.value as ScoreUnit })} value={draft.unit}>
                    {scoreUnits.map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}
                  </select>
                </label>
                <label className={styles.field} htmlFor="scoring-def-direction">
                  Which score wins
                  <select disabled={busy !== null} id="scoring-def-direction" onChange={(event) => change({ higherWins: event.target.value === "higher" })} value={draft.higherWins ? "higher" : "lower"}>
                    <option value="higher">Higher score wins</option>
                    <option value="lower">Lower score wins (a time, for example)</option>
                  </select>
                </label>
                <label className={styles.field} htmlFor="scoring-def-ribbons">
                  Ribbons
                  <select disabled={busy !== null} id="scoring-def-ribbons" onChange={(event) => change({ ribbonMode: event.target.value as RibbonMode })} value={draft.ribbonMode}>
                    {ribbonModes.map((mode) => <option key={mode} value={mode}>{ribbonModeLabels[mode]}</option>)}
                  </select>
                </label>
                {draft.ribbonMode === "PLACES" ? (
                  <label className={styles.field} htmlFor="scoring-def-places">
                    Ribbons go to
                    <select disabled={busy !== null} id="scoring-def-places" onChange={(event) => change({ ribbonPlaces: Number(event.target.value) })} value={draft.ribbonPlaces}>
                      <option value={1}>1st place only</option>
                      <option value={2}>1st and 2nd place</option>
                      <option value={3}>1st, 2nd and 3rd place</option>
                    </select>
                    <span className={styles.help}>Tied scores share a place and each gets that ribbon.</span>
                  </label>
                ) : (
                  <div className={styles.bands} id={fieldIds.bands} tabIndex={-1}>
                    <p className={styles.help}>List bands from the {draft.higherWins ? "highest score to the lowest" : "lowest score to the highest"}. An entry earns the first band it reaches.</p>
                    {draft.bands.map((band, index) => (
                      <div className={styles.band} key={index}>
                        <label className={styles.field} htmlFor={bandId(index, "label")}>
                          Band name
                          <input aria-describedby={definitionErrors[bandId(index, "label")] ? `${bandId(index, "label")}-error` : undefined} aria-invalid={definitionErrors[bandId(index, "label")] ? true : undefined} disabled={busy !== null} id={bandId(index, "label")} maxLength={30} onChange={(event) => change({ bands: draft.bands.map((current, position) => (position === index ? { ...current, label: event.target.value } : current)) }, bandId(index, "label"))} placeholder="Blue" type="text" value={band.label} />
                          {definitionErrors[bandId(index, "label")] && <span className={styles.error} id={`${bandId(index, "label")}-error`}>{definitionErrors[bandId(index, "label")]}</span>}
                        </label>
                        <label className={styles.field} htmlFor={bandId(index, "threshold")}>
                          {draft.higherWins ? "At least" : "At most"}
                          <input aria-describedby={definitionErrors[bandId(index, "threshold")] ? `${bandId(index, "threshold")}-error` : undefined} aria-invalid={definitionErrors[bandId(index, "threshold")] ? true : undefined} disabled={busy !== null} id={bandId(index, "threshold")} inputMode="decimal" onChange={(event) => change({ bands: draft.bands.map((current, position) => (position === index ? { ...current, threshold: event.target.value } : current)) }, bandId(index, "threshold"))} type="text" value={band.threshold} />
                          {definitionErrors[bandId(index, "threshold")] && <span className={styles.error} id={`${bandId(index, "threshold")}-error`}>{definitionErrors[bandId(index, "threshold")]}</span>}
                        </label>
                        <button className="secondary-button" disabled={busy !== null} onClick={() => change({ bands: draft.bands.filter((_, position) => position !== index) })} type="button">Remove<span className="sr-only"> band {index + 1}</span></button>
                      </div>
                    ))}
                    {definitionErrors[fieldIds.bands] && <span className={styles.error}>{definitionErrors[fieldIds.bands]}</span>}
                    {draft.bands.length < 6 && <div className={styles.actions}><button className="secondary-button" disabled={busy !== null} onClick={() => change({ bands: [...draft.bands, { label: "", threshold: "" }] })} type="button">Add a band</button></div>}
                  </div>
                )}
                <div className={styles.actions}>
                  <button className="primary-button" disabled={busy !== null} type="submit">{busy === "definition" ? "Saving…" : "Save scored event"}</button>
                  <button className="secondary-button" disabled={busy !== null} onClick={() => setDraft(null)} type="button">Cancel</button>
                </div>
                {message("definition")}
              </form>
            )}
            {!draft && message("definition")}
          </section>

          <section aria-labelledby="scoring-entry" className={styles.section}>
            <h3 className={styles.heading} id="scoring-entry">Enter a score</h3>
            {state.scoredEvents.length === 0 ? (
              <p className={styles.help}>Add a scored event first, then enter scores here.</p>
            ) : !canEnterNow ? (
              <p className={styles.help}>{caps.canEnter ? "Results are published. Only the Clubs Administrator or event staff can correct a score now." : "Your role doesn't include entering scores."}</p>
            ) : (
              <form className={styles.form} noValidate onSubmit={saveEntry}>
                {entrySummaryItems.length > 0 && <FormErrorSummary items={entrySummaryItems} ref={entrySummaryRef} />}
                <label className={styles.field} htmlFor={fieldIds.event}>
                  Scored event
                  <select disabled={busy !== null} id={fieldIds.event} onChange={(event) => { setScoredEventId(event.target.value); setSubjectId(""); setValue(""); find.setValue(""); setEntryErrors({}); clearEntrySummary(); }} value={scoredEventId}>
                    {state.scoredEvents.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                  </select>
                </label>
                {selected && (
                  <>
                    <div>
                      <label className="search-field">
                        <Search aria-hidden="true" size={18} />
                        <span className="sr-only">{selected.kind === "CLUB" ? "Find a club" : "Find a Pathfinder or club"}</span>
                        <input {...find.inputProps} autoComplete="off" disabled={busy !== null} id="scoring-score-find" placeholder={selected.kind === "CLUB" ? "Find a club" : "Find a Pathfinder or club"} />
                        <SearchClearButton onClear={() => find.setValue("")} visible={find.value !== ""} />
                      </label>
                      <SearchResultStatus message={`${subjects.length} ${subjects.length === 1 ? "match" : "matches"} listed.`} />
                    </div>
                    <label className={styles.field} htmlFor={fieldIds.subject}>
                      {selected.kind === "CLUB" ? "Club" : "Pathfinder"}
                      <select aria-describedby={entryErrors[fieldIds.subject] ? `${fieldIds.subject}-error` : undefined} aria-invalid={entryErrors[fieldIds.subject] ? true : undefined} disabled={busy !== null} id={fieldIds.subject} onChange={(event) => pickSubject(event.target.value)} value={subjectId}>
                        <option value="">{subjects.length === 0 ? "No registered match" : "Choose…"}</option>
                        {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.label}{entryFor(selected.id, subject.id) ? " (scored)" : ""}</option>)}
                      </select>
                      {entryErrors[fieldIds.subject] && <span className={styles.error} id={`${fieldIds.subject}-error`}>{entryErrors[fieldIds.subject]}</span>}
                      {subjects.length === 0 && <span className={styles.help}>{selected.kind === "CLUB" ? "Only clubs registered for this event can be scored." : "Only Pathfinders registered for this event can be scored."}</span>}
                    </label>
                    <label className={styles.field} htmlFor={fieldIds.value}>
                      Score ({unitLabels[selected.unit].toLowerCase()})
                      <input aria-describedby={entryErrors[fieldIds.value] ? `${fieldIds.value}-error` : undefined} aria-invalid={entryErrors[fieldIds.value] ? true : undefined} autoComplete="off" disabled={busy !== null} id={fieldIds.value} inputMode={selected.unit === "TIME" ? "text" : "decimal"} onChange={(event) => { setValue(event.target.value); setEntryErrors({}); clearEntrySummary(); }} placeholder={selected.unit === "TIME" ? "1:02.5" : "85"} type="text" value={value} />
                      {entryErrors[fieldIds.value] && <span className={styles.error} id={`${fieldIds.value}-error`}>{entryErrors[fieldIds.value]}</span>}
                    </label>
                    <div className={styles.actions}>
                      <button className="primary-button" disabled={busy !== null} type="submit">{busy === "entry" ? "Saving…" : "Save score"}</button>
                      {subjectId && entryFor(selected.id, subjectId) && (
                        <button className="secondary-button" disabled={busy !== null} onClick={async () => {
                          const who = subjects.find((subject) => subject.id === subjectId)?.label ?? "this entry";
                          if (!(await confirm({ title: "Remove this score", body: `This deletes the ${selected.name} score for ${who}.`, confirmLabel: "Remove this score", destructive: true }))) return;
                          await send({ action: "saveScore", entry: { scoredEventId: selected.id, subjectId, value: null } }, "entry", "remove", "Score removed.", () => { setSubjectId(""); setValue(""); });
                        }} type="button">
                          {busy === "remove" ? "Saving…" : "Remove this score"}
                        </button>
                      )}
                    </div>
                    {published && <p className={styles.help}>Results are published, so this change is recorded in the audit log.</p>}
                  </>
                )}
                {message("entry")}
              </form>
            )}
          </section>

          <EventScoringResultsView results={state.results} />
        </>
      )}
      {confirmDialog}
    </div>
  );
}
