"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, Mail, Printer, RefreshCw, Trophy } from "lucide-react";
import { TEAM_LEVELS, teamLabel, teamLevelLabels, type TeamLevel, type TeamLevelInfo } from "@/modules/club-teams/domain";
import {
  levelInfoFor,
  levelWhenWhere,
  nextLevel,
  placementLabel,
  teamsAtLevel,
  type LevelTeamRow,
  type TeamResultView,
  type TeamResultsRow,
} from "@/modules/club-teams/results-domain";

type Draft = { placementRank: string; advanceOverride: "" | "yes" | "no"; notes: string };

const draftOf = (result: TeamResultView | null): Draft => ({
  placementRank: result?.placementRank != null ? String(result.placementRank) : "",
  advanceOverride: result?.advanceOverride == null ? "" : result.advanceOverride ? "yes" : "no",
  notes: result?.notes ?? "",
});

const overrideValue = (value: Draft["advanceOverride"]) => (value === "" ? null : value === "yes");

/**
 * One level of one team's result (#809, #945): staff type the place as a number (1 is first), may override whether the
 * team advances, and add a note. 1st and 2nd advance on their own, ties included; an override is kept. Saving a blank level
 * clears it. Read only without the permission to manage registrations.
 */
function LevelEditor({
  eventId,
  row,
  level,
  canEdit,
  onSaved,
}: {
  eventId: string;
  row: TeamResultsRow;
  level: TeamLevel;
  canEdit: boolean;
  onSaved: (result: TeamResultView | null) => void;
}) {
  const stored = row.results[level];
  const next = nextLevel(level);
  const [draft, setDraft] = useState<Draft>(() => draftOf(stored));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const base = `team-result-${row.clubEventRegistrationId}-${level}`;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(stored));
  const label = teamLabel(row.clubName, row.teamName);

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return send(false);
  }

  /** `clear` is the only way to remove a result: saving the fields empty never deletes one. */
  async function send(clear: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/team-results/${encodeURIComponent(row.clubEventRegistrationId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level,
          placementRank: draft.placementRank.trim() === "" ? null : Number(draft.placementRank),
          advanceOverride: overrideValue(draft.advanceOverride),
          notes: draft.notes,
          ...(clear ? { clear: true } : {}),
        }),
      });
      const result = await response.json().catch(() => ({})) as { result?: TeamResultView | null; message?: string };
      if (!response.ok) {
        setMessage({ kind: "error", text: result.message ?? "That result couldn't be saved." });
        return;
      }
      onSaved(result.result ?? null);
      setDraft(draftOf(result.result ?? null));
      setMessage({ kind: "ok", text: result.result ? "Saved." : "Cleared." });
    } catch {
      setMessage({ kind: "error", text: "We couldn't reach the server. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  const status = stored && next
    ? <p className={stored.qualified ? "inline-notice" : "inline-notice warning"} role="status"><strong>{stored.qualified ? `Advancing to ${teamLevelLabels[next]}` : `Not advancing to ${teamLevelLabels[next]}`}</strong>{stored.advanceOverride !== null ? " (staff decision)" : ""}</p>
    : null;
  const legacy = stored?.needsReentry
    ? <p className="inline-notice warning" role="status">Entered before places were numbers: <strong translate="no">{stored.placement}</strong>. Enter the place as a number to replace it.</p>
    : null;

  if (!canEdit) {
    return (
      <div className="team-result-level">
        <strong>{teamLevelLabels[level]}</strong>
        {stored ? <span>{placementLabel(stored) || "No place"}{stored.needsReentry ? " (old entry)" : ""}{next ? ` · ${stored.qualified ? "Advancing" : "Not advancing"}` : ""}{stored.notes ? ` · ${stored.notes}` : ""}</span> : <span className="quiet-copy">No result yet</span>}
      </div>
    );
  }
  return (
    <form className="team-result-level" onSubmit={save} aria-label={`${teamLevelLabels[level]} result for ${label}`}>
      <strong id={`${base}-title`}>{teamLevelLabels[level]}</strong>
      {legacy}
      <label htmlFor={`${base}-place`}>Place (1 is first)
        <input id={`${base}-place`} inputMode="numeric" max={999} min={1} onChange={(event) => setDraft({ ...draft, placementRank: event.target.value })} step={1} type="number" value={draft.placementRank} />
      </label>
      {next && (
        <label htmlFor={`${base}-override`}>Advances to {teamLevelLabels[next]}
          <select id={`${base}-override`} onChange={(event) => setDraft({ ...draft, advanceOverride: event.target.value as Draft["advanceOverride"] })} value={draft.advanceOverride}>
            <option value="">Follow the place (1st and 2nd advance)</option>
            <option value="yes">Advance anyway (staff decision)</option>
            <option value="no">Do not advance (staff decision)</option>
          </select>
        </label>
      )}
      <label htmlFor={`${base}-notes`}>Notes (shown to the club)
        <input id={`${base}-notes`} maxLength={2000} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} value={draft.notes} />
      </label>
      {status}
      <div className="intro-actions">
        <button className="secondary-button" disabled={busy || !dirty} type="submit">{busy ? "Saving…" : "Save"}</button>
        {stored && <button className="secondary-button" disabled={busy} onClick={() => void send(true)} type="button">Clear result</button>}
        {message && <span className={message.kind === "error" ? "inline-notice error" : "field-help"} role={message.kind === "error" ? "alert" : "status"}>{message.kind === "ok" && <CheckCircle2 aria-hidden="true" size={13} />} {message.text}</span>}
      </div>
    </form>
  );
}

/** Check in a whole team for the Conference or Union day: one tap, no new registration. */
function TeamCheckIn({ eventId, team, level, canEdit }: { eventId: string; team: LevelTeamRow; level: TeamLevel; canEdit: boolean }) {
  const [checkedInAt, setCheckedInAt] = useState(team.checkedInAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(checkedIn: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/team-results/${encodeURIComponent(team.clubEventRegistrationId)}/check-in`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, checkedIn }),
      });
      const result = await response.json().catch(() => ({})) as { checkedInAt?: string | null; message?: string };
      if (!response.ok) {
        setError(result.message ?? "That check-in couldn't be saved.");
        return;
      }
      setCheckedInAt(result.checkedInAt ?? null);
    } catch {
      setError("We couldn't reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="team-level-checkin">
      {checkedInAt
        ? <p className="inline-notice success" role="status"><CheckCircle2 aria-hidden="true" size={14} /> Checked in for {teamLevelLabels[level]}</p>
        : <p className="field-help">Not checked in for {teamLevelLabels[level]} yet.</p>}
      {canEdit && (
        <button className="secondary-button" disabled={busy} onClick={() => void set(!checkedInAt)} type="button">
          {busy ? "Saving…" : checkedInAt ? "Undo check-in" : `Check in ${team.teamName || team.clubName}`}
        </button>
      )}
      {error && <p className="inline-notice error" role="alert">{error}</p>}
    </div>
  );
}

type NoticePreview = { toSend: number; alreadyQueued: number; noEmail: number; date: string | null; place: string };

/**
 * "Send notices" (#945): tells the directors of the teams that advanced to the next level, once each. It is a bulk email,
 * so it never goes on its own: staff see how many will go, with the date and place, and confirm.
 */
function SendNotices({ eventId, toLevel }: { eventId: string; toLevel: TeamLevel }) {
  const [preview, setPreview] = useState<NoticePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const endpoint = `/api/events/${encodeURIComponent(eventId)}/team-results/notices`;
  const to = teamLevelLabels[toLevel];

  async function review() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${endpoint}?level=${toLevel}`);
      const result = await response.json().catch(() => ({})) as NoticePreview & { message?: string };
      if (!response.ok) setMessage({ kind: "error", text: result.message ?? "We couldn't check who is waiting." });
      else setPreview(result);
    } catch {
      setMessage({ kind: "error", text: "We couldn't reach the server. Nothing was sent." });
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level: toLevel }) });
      const result = await response.json().catch(() => ({})) as { queued?: number; alreadyQueued?: number; noEmail?: number; message?: string };
      if (!response.ok) {
        setMessage({ kind: "error", text: result.message ?? "The notices couldn't be sent." });
        return;
      }
      setPreview(null);
      setMessage({ kind: "ok", text: `Sent ${result.queued ?? 0} ${result.queued === 1 ? "notice" : "notices"}. ${result.alreadyQueued ? `${result.alreadyQueued} had already been sent. ` : ""}${result.noEmail ? `${result.noEmail} ${result.noEmail === 1 ? "team has" : "teams have"} no director email.` : ""}`.trim() });
    } catch {
      setMessage({ kind: "error", text: "We couldn't reach the server. Check the delivery log before sending again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="team-notices" aria-label={`${to} notices`}>
      {!preview && <button className="secondary-button" disabled={busy} onClick={() => void review()} type="button"><Mail aria-hidden="true" size={14} /> Send {to} notices</button>}
      {preview && (
        <div className="inline-notice warning" role="group" aria-label={`Confirm the ${to} notices`}>
          <p>
            <strong>{preview.toSend === 0 ? "No new notices to send." : `Send ${preview.toSend} ${preview.toSend === 1 ? "notice" : "notices"} to team directors?`}</strong>{" "}
            {preview.alreadyQueued > 0 && `${preview.alreadyQueued} already sent and will be skipped. `}
            {preview.noEmail > 0 && `${preview.noEmail} ${preview.noEmail === 1 ? "team has" : "teams have"} no director email. `}
            {to} date: {preview.date ?? "not set yet"}. {to} place: {preview.place || "not set yet"}.
          </p>
          <div className="intro-actions">
            {preview.toSend > 0 && <button className="primary-button" disabled={busy} onClick={() => void send()} type="button">{busy ? "Sending…" : "Send notices"}</button>}
            <button className="secondary-button" disabled={busy} onClick={() => setPreview(null)} type="button">{preview.toSend > 0 ? "Cancel" : "Close"}</button>
          </div>
        </div>
      )}
      {message && <p className={message.kind === "error" ? "inline-notice error" : "field-help"} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
    </div>
  );
}

export function TeamResultsWorkspace({
  eventId,
  level,
  initialRows,
  levelTeams,
  levelInfo,
  canEdit,
}: {
  eventId: string;
  level: TeamLevel;
  initialRows: TeamResultsRow[];
  levelTeams: LevelTeamRow[];
  levelInfo: TeamLevelInfo[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [recomputeMessage, setRecomputeMessage] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const update = (id: string, at: TeamLevel, result: TeamResultView | null) => setRows((current) => current.map((row) => (
    row.clubEventRegistrationId === id ? { ...row, results: { ...row.results, [at]: result } } : row
  )));
  const eventQuery = `event=${encodeURIComponent(eventId)}`;
  const api = `/api/events/${encodeURIComponent(eventId)}/team-results`;
  const teams = teamsAtLevel(rows, level);
  const peopleById = new Map(levelTeams.map((team) => [team.clubEventRegistrationId, team]));
  const next = nextLevel(level);
  const info = level === "AREA" ? null : levelInfoFor(levelInfo, level);
  const whenWhere = levelWhenWhere(info);

  async function recompute() {
    setRecomputing(true);
    setRecomputeMessage(null);
    try {
      const response = await fetch(`${api}/recompute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level }) });
      const result = await response.json().catch(() => ({})) as { changed?: number; message?: string };
      if (!response.ok) setRecomputeMessage(result.message ?? "That couldn't be recomputed.");
      else setRecomputeMessage(result.changed ? `Updated ${result.changed} ${result.changed === 1 ? "team" : "teams"}. Reload to see them.` : "Nothing changed: every team already follows its place or your decision.");
    } catch {
      setRecomputeMessage("We couldn't reach the server. Nothing was changed.");
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Club registration</p>
          <h2><Trophy aria-hidden="true" size={18} /> Team results</h2>
          <p>
            One event, three levels. Teams register once, for their Area. 1st and 2nd place at a level advance to the next, ties included, unless you decide otherwise.
            A team that does not advance never appears at the next level.
          </p>
        </div>
      </div>
      <nav className="team-level-tabs tab-chips" aria-label="Level">
        {TEAM_LEVELS.map((each) => (
          <Link aria-current={each === level ? "page" : undefined} href={`/more/team-results?${eventQuery}&level=${each}`} key={each}>
            {teamLevelLabels[each]} ({teamsAtLevel(rows, each).length})
          </Link>
        ))}
      </nav>
      <section className="panel" aria-labelledby="team-level-heading">
        <h3 id="team-level-heading">{teamLevelLabels[level]} level · {teams.length} {teams.length === 1 ? "team" : "teams"}</h3>
        {level !== "AREA" && (
          <p className="field-help">
            {whenWhere ? <>When and where: <strong>{whenWhere}</strong>.</> : <>The {teamLevelLabels[level]} date and place are not set yet. Add them in the event&apos;s team settings.</>}
            {" "}Exactly the teams that advanced from {teamLevelLabels[TEAM_LEVELS[TEAM_LEVELS.indexOf(level) - 1]!]}.
          </p>
        )}
        <div className="intro-actions">
          <a className="secondary-button" href={`${api}?format=csv&level=${level}`}><Download aria-hidden="true" size={14} /> Results CSV</a>
          <a className="secondary-button" href={`${api}/roster?format=csv&level=${level}`}><Download aria-hidden="true" size={14} /> Roster CSV</a>
          <Link className="secondary-button" href={`/more/reports/clubs/team-form/level?${eventQuery}&level=${level}`}><Printer aria-hidden="true" size={14} /> Print team forms</Link>
          {level === "AREA" && <Link className="secondary-button" href="/check-in">Check in people (Area day)</Link>}
          {canEdit && <button className="secondary-button" disabled={recomputing} onClick={() => void recompute()} type="button"><RefreshCw aria-hidden="true" size={14} /> {recomputing ? "Working…" : "Recompute who advances"}</button>}
        </div>
        {recomputeMessage && <p className="field-help" role="status">{recomputeMessage}</p>}
        {canEdit && next && <SendNotices eventId={eventId} key={next} toLevel={next} />}
      </section>
      {teams.length === 0 && <section className="panel"><p className="quiet-copy">{level === "AREA" ? "No team is registered yet." : `No team has advanced to ${teamLevelLabels[level]} yet.`}</p></section>}
      {teams.map((row) => {
        const people = peopleById.get(row.clubEventRegistrationId);
        return (
          <section className="panel team-result-card" key={row.clubEventRegistrationId} aria-labelledby={`team-${row.clubEventRegistrationId}`}>
            <h3 id={`team-${row.clubEventRegistrationId}`} translate="no">{row.teamName || row.clubName}</h3>
            <p className="field-help" translate="no">{row.teamName ? `${row.clubName} · ` : ""}{row.church ?? "No church on file"} · {row.confirmationCode}{row.locationName ? ` · Area: ${row.locationName}` : ""}</p>
            {row.permissionsPending > 0 && <p className="inline-notice warning" role="status"><strong>{row.permissionsPending} team {row.permissionsPending === 1 ? "member is" : "members are"} waiting for the Area Coordinator&apos;s approval.</strong></p>}
            {people && level !== "AREA" && (
              <p className="field-help" translate="no">
                Members: {people.members.join(", ") || "none"}{people.alternate ? ` · Alternate: ${people.alternate}` : ""} · Coaches: {people.coaches.join(", ") || "none"}
              </p>
            )}
            <p><Link className="text-button" href={`/more/reports/clubs/team-form/${encodeURIComponent(row.clubEventRegistrationId)}?${eventQuery}`}>Print this team&apos;s form</Link></p>
            {people && level !== "AREA" && <TeamCheckIn canEdit={canEdit} eventId={eventId} level={level} team={people} />}
            <div className="team-result-levels">
              <LevelEditor canEdit={canEdit} eventId={eventId} key={`${row.clubEventRegistrationId}-${level}`} level={level} onSaved={(result) => update(row.clubEventRegistrationId, level, result)} row={row} />
            </div>
          </section>
        );
      })}
    </section>
  );
}
