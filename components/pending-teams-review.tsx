"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CheckCircle2, Plus, Users, XCircle } from "lucide-react";
import { DisabledHint, disabledHintId } from "@/components/disabled-hint";
import { pendingTeamButtons } from "@/modules/general-link-registrations/review-actions";
import type { PendingTeamMemberView, PendingTeamView } from "@/modules/general-link-registrations/repository";
import { addClubBlock, type SimilarClub } from "@/modules/organizations/similar-clubs";

type Club = { id: string; name: string };
/** A church or company a new club can be sponsored by, with its town so same-named ones can be told apart. */
export type SponsorChoice = { id: string; name: string; city: string; state: string };

function sponsorLabel(sponsor: SponsorChoice) {
  const town = [sponsor.city, sponsor.state].filter(Boolean).join(", ");
  return town ? `${sponsor.name} (${town})` : sponsor.name;
}

function personLabel(person: PendingTeamMemberView) {
  const name = `${person.firstName} ${person.lastName}`.trim() || "(no name)";
  return person.alternate ? `${name} (alternate)` : name;
}

/** The staff pages' date format (Oct 16, 2026, 3:17 AM CDT) in the event's own time zone. */
function submittedAt(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(date);
}

type SendOutcome = { ok: boolean; code: string | null };

type Action =
  | { action: "CONFIRM" | "REASSIGN"; organizationId: string }
  | { action: "ADD_CLUB"; clubName: string; sponsoringChurchId: string; acknowledgeSimilar: boolean }
  | { action: "REJECT"; reason: string };

/**
 * Add the club the director typed to the directory and confirm the team in one step (#1031). The name starts as what the director
 * typed; staff correct it and choose the sponsoring church. Close names already in the directory are listed first, so a team
 * that belongs to one of them is attached to it instead of making a duplicate.
 */
function AddClubForm({ eventId, team, sponsors, busy, onSend }: {
  eventId: string; team: PendingTeamView; sponsors: SponsorChoice[]; busy: boolean; onSend: (body: Action) => Promise<SendOutcome>;
}) {
  const [name, setName] = useState(team.clubNameAsEntered);
  const [sponsorId, setSponsorId] = useState("");
  const [matches, setMatches] = useState<SimilarClub[]>([]);
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [problem, setProblem] = useState("");
  // Only the newest check may set what is shown: an older, slower answer is dropped.
  const latest = useRef(0);
  const key = `${name.trim()}|${sponsorId}`;
  const idBase = `add-club-${team.id}`;

  async function check(nextName: string, nextSponsor: string) {
    const nextKey = `${nextName.trim()}|${nextSponsor}`;
    const mine = ++latest.current;
    setAcknowledged(false);
    setChecking(true);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/general-link/teams/${encodeURIComponent(team.id)}/similar-clubs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubName: nextName, sponsoringChurchId: nextSponsor || null }),
      });
      const result = await response.json().catch(() => ({})) as { matches?: SimilarClub[]; message?: string };
      if (mine !== latest.current) return;
      if (!response.ok) {
        setProblem(result.message ?? "We couldn't check the directory for similar clubs.");
        setMatches([]);
        setCheckedFor(null);
        return;
      }
      setProblem("");
      setMatches(result.matches ?? []);
      setCheckedFor(nextKey);
    } catch {
      if (mine !== latest.current) return;
      setProblem("We couldn't reach the server to check for similar clubs.");
      setCheckedFor(null);
    } finally {
      if (mine === latest.current) setChecking(false);
    }
  }

  async function add() {
    const outcome = await onSend({ action: "ADD_CLUB", clubName: name, sponsoringChurchId: sponsorId, acknowledgeSimilar: acknowledged });
    // The directory changed since the last check (a club was added, or one is a duplicate): look again and start from the new list.
    if (!outcome.ok && (outcome.code === "SIMILAR_CLUBS" || outcome.code === "CLUB_EXISTS")) await check(name, sponsorId);
  }

  const checked = checkedFor === key;
  const blocked = checked ? addClubBlock(matches, true) : null;
  const reason = name.trim().length < 2 ? "Enter the club's name."
    : sponsorId === "" ? "Choose the sponsoring church or company."
    : !checked ? (checking ? "Checking the directory for similar clubs…" : "The directory is checked for similar clubs when you leave the name or choose a church.")
    : blocked ? "A club with this name is already in the directory. Attach the team to it, or change the name."
    : matches.length > 0 && !acknowledged ? "Check the clubs above, then tick that none of them is the club."
    : null;
  const status = checking ? "Checking the directory…"
    : checked && matches.length > 0 ? `${matches.length} ${matches.length === 1 ? "club" : "clubs"} with a similar name. Check ${matches.length === 1 ? "it" : "them"} before adding.`
    : checked ? "No similar clubs in the directory."
    : "";
  return (
    <div className="form-stack pending-team-add-club" role="group" aria-label="Add this club to the directory">
      <label>
        Club name
        <input disabled={busy} maxLength={160} onBlur={() => void check(name, sponsorId)} onChange={(event) => setName(event.target.value)} type="text" value={name} />
      </label>
      <label>
        Sponsoring church or company
        <select aria-describedby={`${idBase}-sponsor-help`} disabled={busy} onChange={(event) => { setSponsorId(event.target.value); void check(name, event.target.value); }} value={sponsorId}>
          <option value="">Choose a church…</option>
          {sponsors.map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsorLabel(sponsor)}</option>)}
        </select>
      </label>
      <small className="field-help" id={`${idBase}-sponsor-help`}>Every club in the directory belongs to a church or company; its town tells same-named ones apart.</small>
      {problem && <div className="inline-notice error" role="alert">{problem}</div>}
      <p aria-live="polite" className="field-help pending-team-check-status" role="status">{status}</p>
      {matches.length > 0 && (
        <div className="pending-team-matches" role="region" aria-label="Clubs already in the directory with a similar name">
          <p className="field-help"><strong>Already in the directory.</strong> If the team belongs to one of these, attach it instead of adding a duplicate.</p>
          <ul>
            {matches.map((match) => (
              <li key={match.id}>
                <span>
                  <strong translate="no">{match.name}</strong>
                  {" "}<small>({match.kind === "SAME_NAME" ? "same name" : "similar"}{match.isActive ? "" : " · inactive"}{match.sponsorName ? ` · ${match.sponsorName}` : ""}{match.city ? `, ${match.city}` : ""}{match.sameSponsor ? " · same church" : match.sameArea ? " · same town" : ""})</small>
                </span>
                {match.isActive && (
                  <button className="secondary-button" disabled={busy} onClick={() => void onSend({ action: "REASSIGN", organizationId: match.id })} type="button">Attach to this club</button>
                )}
              </li>
            ))}
          </ul>
          {!blocked && (
            <label className="checkbox-label">
              <input checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" />
              None of these is the club. Add a new one.
            </label>
          )}
        </div>
      )}
      <div className="intro-actions pending-team-actions">
        <button
          aria-describedby={disabledHintId(reason, `${idBase}-hint`)}
          className="primary-button"
          disabled={busy || reason !== null}
          onClick={() => void add()}
          type="button"
        >
          <Plus aria-hidden="true" size={16} /> Add club and confirm team
        </button>
      </div>
      <DisabledHint id={`${idBase}-hint`} reason={reason} />
    </div>
  );
}

function TeamRow({ eventId, team, clubs, sponsors, canAddClub, timeZone }: { eventId: string; team: PendingTeamView; clubs: Club[]; sponsors: SponsorChoice[]; canAddClub: boolean; timeZone: string }) {
  const router = useRouter();
  const [choice, setChoice] = useState(team.suggestedClub?.id ?? team.emailClubs[0]?.id ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [addingClub, setAddingClub] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function send(body: Action): Promise<SendOutcome> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/general-link/teams/${encodeURIComponent(team.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; message?: string; result?: { status: string; clubName: string | null } };
      if (!response.ok) {
        setError(result.message ?? "That couldn't be saved. Nothing was changed.");
        // Someone else may have handled it: show the current list. (Not for a club that turned out to be a duplicate: the form re-checks.)
        if (response.status === 409 && result.error !== "SIMILAR_CLUBS" && result.error !== "CLUB_EXISTS") router.refresh();
        return { ok: false, code: result.error ?? null };
      }
      setDone(result.result?.status === "REJECTED"
        ? "Rejected. The director was told."
        : body.action === "ADD_CLUB"
          ? `Added ${result.result?.clubName ?? "the club"} to the directory and attached the team.`
          : `Attached to ${result.result?.clubName ?? "the club"}.`);
      router.refresh();
      return { ok: true, code: null };
    } catch {
      setError("We couldn't reach the server. Nothing was changed.");
      return { ok: false, code: null };
    } finally {
      setBusy(false);
    }
  }

  const suggested = team.suggestedClub;
  const chosenName = clubs.find((club) => club.id === choice)?.name ?? "this club";
  // Confirming the club the director named and attaching to the club picked are the same action when they are the same club.
  const buttons = pendingTeamButtons({ suggestedId: suggested?.id ?? null, choiceId: choice });
  return (
    <article className="panel pending-team" aria-label={`Team ${team.teamName || team.confirmationCode}`}>
      <header className="pending-team-head">
        <h3 className="pending-team-title">
          <Users aria-hidden="true" size={18} />
          <span translate="no">{team.teamName || "Team"}</span>
          <small className="pending-team-code" translate="no">{team.confirmationCode}</small>
        </h3>
        <p className="pending-team-meta">
          Club named <strong>{team.clubNameAsEntered || "not listed"}</strong>
          {suggested ? "" : " (not in the directory)"} · {team.attendeeCount} {team.attendeeCount === 1 ? "person" : "people"}
          {team.locationName ? ` · ${team.locationName}` : ""}
        </p>
        <p className="field-help">
          Submitted {submittedAt(team.createdAt, timeZone)} by {team.directorName || "the director"}
          {" "}({team.directorEmail})
        </p>
        <p className="field-help">
          <strong>Members{team.members.length > 0 ? ` (${team.members.length})` : ""}:</strong>{" "}
          {team.members.length > 0 ? team.members.map(personLabel).join(", ") : "none listed"}
        </p>
        {team.coaches.length > 0 && (
          <p className="field-help"><strong>Coaches ({team.coaches.length}):</strong> {team.coaches.map(personLabel).join(", ")}</p>
        )}
        {team.emailClubs.length > 0 && (
          <p className="field-help">This email is a director or deputy of: {team.emailClubs.map((club) => club.name).join(", ")}.</p>
        )}
      </header>
      {done && <div className="inline-notice" role="status"><CheckCircle2 aria-hidden="true" size={14} /> {done}</div>}
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {!done && (
        <>
          <div className="form-stack pending-team-club">
            <label>
              Club
              <select disabled={busy} onChange={(event) => setChoice(event.target.value)} value={choice}>
                <option value="">Choose a club…</option>
                {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
              </select>
            </label>
          </div>
          <div className="intro-actions pending-team-actions">
            {suggested && buttons.confirmNamed && (
              <button className={`${buttons.confirmNamed.style}-button`} disabled={busy} onClick={() => void send({ action: "CONFIRM", organizationId: buttons.confirmNamed!.organizationId })} type="button">
                Confirm {suggested.name}
              </button>
            )}
            {buttons.attachChosen && (
              <button
                className="primary-button"
                disabled={busy || !choice}
                onClick={() => void send({ action: buttons.attachChosen!.action, organizationId: buttons.attachChosen!.organizationId })}
                type="button"
              >
                {suggested ? `Attach to ${chosenName}` : "Attach to this club"}
              </button>
            )}
            {!suggested && canAddClub && (
              <button aria-expanded={addingClub} className="secondary-button" disabled={busy} onClick={() => setAddingClub((open) => !open)} type="button"><Plus aria-hidden="true" size={16} /> Add this club to the directory</button>
            )}
            <button aria-expanded={rejecting} className="secondary-button pending-team-reject" disabled={busy} onClick={() => setRejecting((open) => !open)} type="button"><XCircle aria-hidden="true" size={16} /> Reject</button>
          </div>
          {!suggested && !canAddClub && (
            <p className="field-help">This club is not in the directory. A system administrator can add it and confirm the team in one step.</p>
          )}
          {addingClub && !suggested && canAddClub && <AddClubForm busy={busy} eventId={eventId} onSend={send} sponsors={sponsors} team={team} />}
          {rejecting && (
            <div className="form-stack">
              <label>
                Reason (the director is told)
                <textarea maxLength={500} onChange={(event) => setReason(event.target.value)} rows={3} value={reason} />
              </label>
              <div className="intro-actions">
                <button className="secondary-button" disabled={busy || !reason.trim()} onClick={() => void send({ action: "REJECT", reason })} type="button">Reject this team</button>
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** The waiting teams (#931), each with one-click confirm of the club the director picked, a club menu to change it, and reject. */
export function PendingTeamsReview({ eventId, teams, clubs, sponsors = [], canAddClub = false, timeZone = "UTC" }: {
  eventId: string; teams: PendingTeamView[]; clubs: Club[]; sponsors?: SponsorChoice[]; canAddClub?: boolean; timeZone?: string;
}) {
  return (
    <div className="page-stack" aria-label="Teams waiting for a club">
      {teams.map((team) => <TeamRow canAddClub={canAddClub} clubs={clubs} eventId={eventId} key={team.id} sponsors={sponsors} team={team} timeZone={timeZone} />)}
    </div>
  );
}
