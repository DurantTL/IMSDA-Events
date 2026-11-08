"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote, SortableHeader, useAddressSort } from "@/components/list-sort";
import { SearchClearButton } from "@/components/search-clear-button";
import { SearchResultStatus, useClientSearch } from "@/components/search-as-you-type";
import { cardCell } from "@/components/table-card-labels";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { sortOrderText, sortRows, type SortState } from "@/lib/list-sort";
import { paginate } from "@/lib/pagination";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { MAX_OVERRIDE_REASON, basisText, parsePointsText } from "@/modules/event-points/domain";
import type { AttendancePointsView, ReviewClub } from "@/modules/event-points/service";
import styles from "@/components/attendance-points-workspace.module.css";

type Message = { tone: "success" | "error"; text: string };
type Section = "switch" | "settings" | "apply" | "review";

const PAGE_SIZE = 20;
const CLUB_COLUMNS = ["club", "present", "counted", "points", "why"] as const;
type ClubColumn = (typeof CLUB_COLUMNS)[number];
const CLUB_DEFAULT_SORT: SortState<ClubColumn> = { key: "club", dir: "asc" };
const clubAccessors: Record<ClubColumn, (club: ReviewClub) => string | number> = {
  club: (club) => club.name,
  present: (club) => club.present,
  counted: (club) => club.leaders + club.tlts + club.pathfinders,
  points: (club) => club.appliedPoints ?? club.points,
  why: (club) => club.reason,
};
const clubSortWords: Record<ClubColumn, string> = { club: "club name", present: "people present", counted: "people counted", points: "points", why: "reason" };
const pointsFieldId = "attendance-points-value";
const formatNumber = (value: number) => value.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 directors or staff, 1 TLT, 5 Pathfinders", or "Nobody counted". Counts only. */
function countedText(club: Pick<ReviewClub, "leaders" | "tlts" | "pathfinders">) {
  const parts = [
    club.leaders > 0 ? plural(club.leaders, "director or staff member", "directors or staff") : "",
    club.tlts > 0 ? plural(club.tlts, "TLT") : "",
    club.pathfinders > 0 ? plural(club.pathfinders, "Pathfinder") : "",
  ].filter(Boolean);
  return parts.length === 0 ? "Nobody counted" : parts.join(", ");
}

/**
 * Attendance points (#1677) for an Area Coordinator (coordinator portal) and for staff (More). Same workspace, different
 * endpoint: the server decides who may do each action. An Area Coordinator sees counts and reasons by club; names, marking,
 * overrides, apply and undo are for staff administrators. Off hides everything but the switch and keeps the data.
 * Works on a phone: single column, 44px controls, tables turn into cards.
 */
export function AttendancePointsWorkspace({ endpoint, initial }: { endpoint: string; initial: AttendancePointsView }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Partial<Record<Section, Message>>>({});
  const caps = state.capabilities;
  const applied = state.appliedAt !== null;

  const [pointsText, setPointsText] = useState(initial.settings ? String(initial.settings.points) : "");
  const [requiresPathfinders, setRequiresPathfinders] = useState(initial.settings?.requiresPathfinders ?? false);
  const [pointsError, setPointsError] = useState("");
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const find = useClientSearch();
  const sort = useAddressSort(CLUB_COLUMNS, CLUB_DEFAULT_SORT, () => setPage(1));
  const panelRef = useRef<HTMLElement>(null);
  const [focusPanel, setFocusPanel] = useState(0);
  const { confirm, ask, confirmDialog } = useConfirm();

  async function send(body: object, section: Section, busyKey: string, done: string): Promise<boolean> {
    setBusy(busyKey);
    setMessages((current) => ({ ...current, [section]: undefined }));
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { state?: AttendancePointsView; message?: string; field?: string };
      if (!response.ok || !result.state) {
        const text = result.message ?? "Try again.";
        if (section === "settings") setPointsError(text);
        setMessages((current) => ({ ...current, [section]: { tone: "error", text: notSavedMessage(text) } }));
        return false;
      }
      setState(result.state);
      setMessages((current) => ({ ...current, [section]: { tone: "success", text: savedMessage(done) } }));
      return true;
    } catch {
      setMessages((current) => ({ ...current, [section]: { tone: "error", text: notSavedMessage("Check your connection and try again.") } }));
      return false;
    } finally {
      setBusy(null);
    }
  }

  /* ---- settings ---- */

  const savedPointsText = state.settings ? String(state.settings.points) : "";
  const settingsDirty = pointsText.trim().replace(/,/g, "") !== savedPointsText || requiresPathfinders !== (state.settings?.requiresPathfinders ?? false);
  useUnsavedChangesGuard(settingsDirty && pointsText.trim() !== "" && busy === null, "You have unsaved attendance points. Leave this page and discard them?");

  function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parsePointsText(pointsText);
    if (!parsed.ok) {
      setPointsError(parsed.message);
      return;
    }
    setPointsError("");
    void send({ action: "saveSettings", points: parsed.points, requiresPathfinders }, "settings", "settings", "").then((ok) => {
      if (ok) setPointsText(String(parsed.points));
    });
  }

  /* ---- review ---- */

  const needle = find.term.trim().toLowerCase();
  const matches = useMemo(() => state.clubs.filter((club) => !needle || club.name.toLowerCase().includes(needle)), [state.clubs, needle]);
  const sortedMatches = useMemo(() => sortRows(matches, sort.key, sort.dir, clubAccessors), [matches, sort.key, sort.dir]);
  const slice = paginate(sortedMatches, page, PAGE_SIZE);
  const selected = state.clubs.find((club) => club.organizationId === selectedClubId) ?? null;
  const message = (section: Section) => messages[section] && <FormMessage message={messages[section]!.text} tone={messages[section]!.tone} />;
  const when = state.appliedAt ? formatInConferenceTime(state.appliedAt, { dateStyle: "medium", timeStyle: "short" }) : null;

  // Opening a club on a phone: bring the "Who counted" panel into view and move focus to its heading. Close puts focus back on
  // that club's Review button.
  useEffect(() => {
    if (focusPanel === 0) return;
    const panel = panelRef.current;
    if (!panel) return;
    panel.scrollIntoView({ block: "start" });
    panel.focus();
  }, [focusPanel]);

  function openClub(id: string) {
    setSelectedClubId(id);
    setFocusPanel((count) => count + 1);
  }

  function closeClub() {
    const id = selectedClubId;
    setSelectedClubId(null);
    if (id) requestAnimationFrame(() => document.getElementById(`points-review-${id}`)?.focus());
  }

  async function overrideClub(club: ReviewClub, outcome: "AWARD" | "WITHHOLD") {
    const verb = outcome === "AWARD" ? "Award" : "Withhold";
    const reason = await ask({
      title: `${verb} points: ${club.name}`,
      body: outcome === "AWARD" ? `${club.name} will get the points whatever the rules say. The reason is shown on this list.` : `${club.name} will get no points whatever the rules say. The reason is shown on this list.`,
      confirmLabel: `${verb} points for ${club.name}`,
      input: { label: "Reason", required: true, maxLength: MAX_OVERRIDE_REASON, multiline: true, hint: "Say why, without a person's name or health details." },
    });
    if (reason === null) return;
    await send({ action: "override", organizationId: club.organizationId, outcome, reason }, "review", `override-${club.organizationId}`, "");
  }

  async function clearOverride(club: ReviewClub) {
    if (!(await confirm({ title: `Use the rules for ${club.name}`, body: "The override is removed and the rules decide this club again.", confirmLabel: `Use the rules for ${club.name}` }))) return;
    await send({ action: "override", organizationId: club.organizationId, outcome: null, reason: "" }, "review", `override-${club.organizationId}`, "");
  }

  async function applyPoints() {
    const body = `${plural(state.totals.clubsEarning, "club")} will get ${formatNumber(state.settings?.points ?? 0)} points each, ${formatNumber(state.totals.points)} in all, with ${state.eventName} as the reason. Monthly Records points are not changed. You can undo this.`;
    if (!(await confirm({ title: `Apply points for ${state.eventName}`, body, confirmLabel: "Apply points" }))) return;
    await send({ action: "apply" }, "apply", "apply", "The points are on the clubs' points board.");
  }

  async function undoPoints() {
    if (!(await confirm({ title: `Undo points for ${state.eventName}`, body: "The points come off every club's total. Overrides and settings are kept, so you can apply again.", confirmLabel: "Undo points", destructive: true }))) return;
    await send({ action: "undo" }, "apply", "undo", "The points are off the clubs' points board.");
  }


  const eventNameNode = <span translate="no">{state.eventName}</span>;

  return (
    <div className={styles.workspace} data-testid="attendance-points-workspace">
      <section aria-labelledby="points-switch" className={styles.section}>
        <h3 className={styles.heading} id="points-switch">Attendance points are {state.enabled ? "on" : "off"}</h3>
        <div className={styles.row}>
          <p className={styles.state} role="status">
            {state.enabled ? "Set the points below, then review the clubs after the event. Clubs see nothing until the points are applied." : "Clubs see nothing, and the tool is hidden. Anything already set up is kept, and applied points stay on the points board."}
          </p>
          {caps.canSwitch && (
            <button className="secondary-button" disabled={busy !== null} onClick={() => send({ action: "switch", enabled: !state.enabled }, "switch", "switch", state.enabled ? "Turned off. Your settings and any applied points are kept." : "Turned on.")} type="button">
              {busy === "switch" ? "Saving…" : state.enabled ? "Turn off" : "Turn on"}
            </button>
          )}
        </div>
        {message("switch")}
      </section>

      {state.enabled && (
        <>
          <section aria-labelledby="points-settings" className={styles.section}>
            <h3 className={styles.heading} id="points-settings">Points for this event</h3>
            <form className={styles.form} noValidate onSubmit={saveSettings}>
              <label className={styles.field} htmlFor={pointsFieldId}>
                Points a club earns for being represented
                <input
                  aria-describedby={pointsError ? `${pointsFieldId}-error` : `${pointsFieldId}-help`}
                  aria-invalid={pointsError ? true : undefined}
                  autoComplete="off"
                  disabled={busy !== null || applied}
                  id={pointsFieldId}
                  inputMode="numeric"
                  onChange={(event) => { setPointsText(event.target.value); setPointsError(""); }}
                  value={pointsText}
                />
                {pointsError ? <span className={styles.error} id={`${pointsFieldId}-error`}>{pointsError}</span> : <span className={styles.help} id={`${pointsFieldId}-help`}>For example 1,500. Each club that counts gets this once.</span>}
              </label>
              <label className={styles.check}>
                <input checked={requiresPathfinders} disabled={busy !== null || applied} onChange={(event) => setRequiresPathfinders(event.target.checked)} type="checkbox" />
                This event needs Pathfinders present
              </label>
              <p className={styles.help}>Tick this for a camporee: a club with only leaders (directors, staff and TLTs) earns nothing. Leave it off for events like Leadership Weekend.</p>
              {!applied && <div className={styles.actions}><button className="primary-button" disabled={busy !== null} type="submit">{busy === "settings" ? "Saving…" : "Save points"}</button></div>}
              {applied && <p className={styles.help}>The points are applied, so these can&apos;t change. {caps.canApply ? "Undo the points first to change them." : "Ask the Clubs Administrator or event staff to undo them first."}</p>}
              {message("settings")}
            </form>
          </section>

          <section aria-labelledby="points-review" className={styles.section}>
            <h3 className={styles.heading} id="points-review">Review clubs</h3>
            {!state.settings ? (
              <p className={styles.help}>Save the points above to see each club and why it did or didn&apos;t earn them.</p>
            ) : (
              <>
                <p className={styles.state}>{basisText(state.basis, state.checkedIn)}. {state.totals.clubsEarning} of {plural(state.totals.clubsReviewed, "club")} earn points, {formatNumber(state.totals.points)} in all.</p>
                <p className={styles.help}>
                  Directors and staff count whatever other role they hold. TLTs count, and need a supervising adult present if under 18. An Area Coordinator&apos;s child doesn&apos;t count{state.settings.requiresPathfinders ? ". This event needs Pathfinders present, so leaders alone don't earn points" : ""}.
                </p>
                {state.clubs.length === 0 ? (
                  <p className={styles.help}>No club has registered for {eventNameNode} yet. Clubs appear here once their registration is submitted. Nothing to review until then.</p>
                ) : (
                  <>
                    <div>
                      <label className="search-field">
                        <Search aria-hidden="true" size={18} />
                        <span className="sr-only">Find a club</span>
                        <input {...find.inputProps} autoComplete="off" onChange={(event) => { find.inputProps.onChange(event); setPage(1); }} placeholder="Find a club" />
                        <SearchClearButton onClear={() => { find.setValue(""); setPage(1); }} visible={find.value !== ""} />
                      </label>
                      <SearchResultStatus message={`${matches.length} ${matches.length === 1 ? "club" : "clubs"} listed.`} />
                    </div>
                    {matches.length === 0 ? (
                      <p className={styles.help}>No club matches that search. Clear the search to see every club.</p>
                    ) : (
                      <>
                      {sort.key && <SortOrderNote>{sortOrderText(clubSortWords[sort.key], sort.dir, sort.key === "club" || sort.key === "why" ? "text" : "number")}</SortOrderNote>}
                      <div className="report-table-wrap">
                        <table className="report-table table-cards" role="table">
                          <caption className="sr-only">Attendance points by club for {state.eventName}</caption>
                          <thead role="rowgroup">
                            <tr role="row">
                              <SortableHeader active={sort.key === "club"} direction={sort.dir} label="Club" onSort={() => sort.toggle("club", "asc")} />
                              <SortableHeader active={sort.key === "present"} direction={sort.dir} label="Present" onSort={() => sort.toggle("present", "desc")} />
                              <SortableHeader active={sort.key === "counted"} direction={sort.dir} label="Counted" onSort={() => sort.toggle("counted", "desc")} />
                              <SortableHeader active={sort.key === "points"} direction={sort.dir} label="Points" onSort={() => sort.toggle("points", "desc")} />
                              <SortableHeader active={sort.key === "why"} direction={sort.dir} label="Why" onSort={() => sort.toggle("why", "asc")} />
                              {caps.canSeeNames && <th role="columnheader" scope="col"><span className="sr-only">Review</span></th>}
                            </tr>
                          </thead>
                          <tbody role="rowgroup">
                            {slice.items.map((club) => (
                              <tr key={club.organizationId} role="row">
                                <th role="rowheader" scope="row" translate="no">{club.name}</th>
                                <td {...cardCell("Present")}>{club.present} of {club.registered}</td>
                                <td {...cardCell("Counted")}>{countedText(club)}</td>
                                <td {...cardCell("Points")}><strong>{formatNumber(club.appliedPoints ?? club.points)}</strong>{club.appliedPoints !== null ? " applied" : ""}</td>
                                <td {...cardCell("Why")}>{club.reason}</td>
                                {caps.canSeeNames && (
                                  <td {...cardCell(null)}>
                                    <button className="secondary-button" id={`points-review-${club.organizationId}`} onClick={() => openClub(club.organizationId)} type="button">Review<span className="sr-only">: {club.name}</span></button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      </>
                    )}
                    <ListPager label="Clubs pages" noun="clubs" nounOne="club" onPage={setPage} slice={slice} />
                  </>
                )}
                {!caps.canSeeNames && state.clubs.length > 0 && <p className={styles.help}>You see counts by club. Names, overrides and applying the points are for the Clubs Administrator and event staff.</p>}
                {message("review")}
              </>
            )}
          </section>

          {selected && selected.people && (
            <section aria-labelledby="points-club" className={styles.section} data-testid="attendance-points-club" id="points-club-panel" ref={panelRef} tabIndex={-1}>
              <h3 className={styles.heading} id="points-club">Who counted: <span translate="no">{selected.name}</span></h3>
              <p className={styles.state}>{selected.reason}</p>
              {selected.override && <p className={styles.help}>The rules alone said: {selected.computedReason}</p>}
              <div className="report-table-wrap">
                <table className="report-table table-cards" role="table">
                  <caption className="sr-only">People registered for {state.eventName} with {selected.name}</caption>
                  <thead role="rowgroup">
                    <tr role="row">
                      <th role="columnheader" scope="col">Person</th>
                      <th role="columnheader" scope="col">Role</th>
                      <th role="columnheader" scope="col">Counted</th>
                      <th role="columnheader" scope="col">Why</th>
                      <th role="columnheader" scope="col"><span className="sr-only">Mark</span></th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {selected.people.map((person) => (
                      <tr key={person.attendeeId} role="row">
                        <th role="rowheader" scope="row" translate="no">{person.name}</th>
                        <td {...cardCell("Role")}>{person.role}</td>
                        <td {...cardCell("Counted")}>{person.counted ? "Counted" : "Not counted"}</td>
                        <td {...cardCell("Why")}>{person.reason}</td>
                        <td {...cardCell(null)}>
                          {caps.canMark && person.canMark && !applied && (
                            <button
                              className="secondary-button"
                              disabled={busy !== null}
                              onClick={() => send({ action: "markChild", attendeeId: person.attendeeId, marked: !person.marked }, "review", `mark-${person.attendeeId}`, "")}
                              type="button"
                            >
                              {busy === `mark-${person.attendeeId}` ? "Saving…" : person.marked ? "Unmark" : "Mark as an Area Coordinator's child"}<span className="sr-only">: {person.name}</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {caps.canOverride && (
                <div className={styles.actions}>
                  <button className="secondary-button" disabled={busy !== null || applied} onClick={() => overrideClub(selected, "AWARD")} type="button">{busy === `override-${selected.organizationId}` ? "Saving…" : "Award points anyway"}<span className="sr-only">: {selected.name}</span></button>
                  <button className="secondary-button" disabled={busy !== null || applied} onClick={() => overrideClub(selected, "WITHHOLD")} type="button">Withhold points<span className="sr-only">: {selected.name}</span></button>
                  {selected.override && <button className="secondary-button" disabled={busy !== null || applied} onClick={() => clearOverride(selected)} type="button">Use the rules<span className="sr-only">: {selected.name}</span></button>}
                  <button className="secondary-button" onClick={closeClub} type="button">Close</button>
                </div>
              )}
              {applied && <p className={styles.help}>The points are applied. Undo them to change a mark or override.</p>}
            </section>
          )}

          <section aria-labelledby="points-apply" className={styles.section}>
            <h3 className={styles.heading} id="points-apply">Points board</h3>
            <div className={styles.row}>
              <p className={styles.state} role="status">
                {applied ? <>Applied {when}. The points are on each club&apos;s points board with {eventNameNode} as the reason.</> : <>Not applied. Nothing is on the points board yet.</>}
              </p>
              {caps.canApply && (applied ? (
                <button className="secondary-button" disabled={busy !== null} onClick={undoPoints} type="button">{busy === "undo" ? "Saving…" : "Undo points"}</button>
              ) : (
                <button className="primary-button" disabled={busy !== null || !state.settings || state.totals.points === 0 || !state.eventEnded} onClick={applyPoints} type="button">{busy === "apply" ? "Saving…" : "Apply points"}</button>
              ))}
            </div>
            {!applied && !state.eventEnded && <p className={styles.help}>The event hasn&apos;t ended yet. Apply the points after the event.</p>}
            {!applied && state.eventEnded && state.settings && state.totals.points === 0 && state.clubs.length > 0 && <p className={styles.help}>No club earned points yet. Review the clubs above, or override one that should.</p>}
            {!applied && !state.settings && <p className={styles.help}>Save the points first.</p>}
            {!caps.canApply && <p className={styles.help}>Only the Clubs Administrator or event staff apply or undo points. Ask them once the review looks right.</p>}
            {message("apply")}
          </section>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
