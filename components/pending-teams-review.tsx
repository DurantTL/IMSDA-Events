"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Users, XCircle } from "lucide-react";
import type { PendingTeamView } from "@/modules/general-link-registrations/repository";

type Club = { id: string; name: string };

type Action =
  | { action: "CONFIRM" | "REASSIGN"; organizationId: string }
  | { action: "REJECT"; reason: string };

function TeamRow({ eventId, team, clubs }: { eventId: string; team: PendingTeamView; clubs: Club[] }) {
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
  return (
    <article className="panel" aria-label={`Team ${team.teamName || team.confirmationCode}`}>
      <div className="section-heading">
        <div>
          <h3><Users aria-hidden="true" size={16} /> {team.teamName || "Team"} <small>{team.confirmationCode}</small></h3>
          <p>
            Club named: <strong>{team.clubNameAsEntered || "not listed"}</strong>
            {suggested ? "" : " (not in the directory)"} · {team.attendeeCount} {team.attendeeCount === 1 ? "person" : "people"}
            {team.locationName ? ` · ${team.locationName}` : ""}
          </p>
          <p className="field-help">
            Submitted {new Date(team.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} by {team.directorName || "the director"}
            {" "}({team.directorEmail})
          </p>
          {team.emailClubs.length > 0 && (
            <p className="field-help">This email is a director or deputy of: {team.emailClubs.map((club) => club.name).join(", ")}.</p>
          )}
        </div>
      </div>
      {done && <div className="inline-notice" role="status"><CheckCircle2 aria-hidden="true" size={14} /> {done}</div>}
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {!done && (
        <>
          <div className="form-grid two-column">
            <label>
              Club
              <select disabled={busy} onChange={(event) => setChoice(event.target.value)} value={choice}>
                <option value="">Choose a club…</option>
                {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
              </select>
            </label>
          </div>
          <div className="intro-actions">
            {suggested && (
              <button className="primary-button" disabled={busy} onClick={() => void send({ action: "CONFIRM", organizationId: suggested.id })} type="button">
                Confirm {suggested.name}
              </button>
            )}
            <button
              className={suggested ? "secondary-button" : "primary-button"}
              disabled={busy || !choice}
              onClick={() => void send({ action: choice === suggested?.id ? "CONFIRM" : "REASSIGN", organizationId: choice })}
              type="button"
            >
              {suggested ? "Attach to the chosen club" : "Attach to this club"}
            </button>
            <button className="text-button" disabled={busy} onClick={() => setRejecting((open) => !open)} type="button"><XCircle aria-hidden="true" size={14} /> Reject</button>
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
export function PendingTeamsReview({ eventId, teams, clubs }: { eventId: string; teams: PendingTeamView[]; clubs: Club[] }) {
  return (
    <div className="page-stack" aria-label="Teams waiting for a club">
      {teams.map((team) => <TeamRow clubs={clubs} eventId={eventId} key={team.id} team={team} />)}
    </div>
  );
}
