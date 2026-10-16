"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Users, XCircle } from "lucide-react";
import { pendingTeamButtons } from "@/modules/general-link-registrations/review-actions";
import type { PendingTeamMemberView, PendingTeamView } from "@/modules/general-link-registrations/repository";

type Club = { id: string; name: string };

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

type Action =
  | { action: "CONFIRM" | "REASSIGN"; organizationId: string }
  | { action: "REJECT"; reason: string };

function TeamRow({ eventId, team, clubs, timeZone }: { eventId: string; team: PendingTeamView; clubs: Club[]; timeZone: string }) {
  const router = useRouter();
  const [choice, setChoice] = useState(team.suggestedClub?.id ?? team.emailClubs[0]?.id ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function send(body: Action) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/general-link/teams/${encodeURIComponent(team.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; result?: { status: string; clubName: string | null } };
      if (!response.ok) {
        setError(result.message ?? "That couldn't be saved. Nothing was changed.");
        // Someone else may have handled it: show the current list.
        if (response.status === 409) router.refresh();
        return;
      }
      setDone(result.result?.status === "REJECTED" ? "Rejected. The director was told." : `Attached to ${result.result?.clubName ?? "the club"}.`);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Nothing was changed.");
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
            <button aria-expanded={rejecting} className="secondary-button pending-team-reject" disabled={busy} onClick={() => setRejecting((open) => !open)} type="button"><XCircle aria-hidden="true" size={16} /> Reject</button>
          </div>
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
export function PendingTeamsReview({ eventId, teams, clubs, timeZone = "UTC" }: { eventId: string; teams: PendingTeamView[]; clubs: Club[]; timeZone?: string }) {
  return (
    <div className="page-stack" aria-label="Teams waiting for a club">
      {teams.map((team) => <TeamRow clubs={clubs} eventId={eventId} key={team.id} team={team} timeZone={timeZone} />)}
    </div>
  );
}
