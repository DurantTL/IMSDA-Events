"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, Trash2 } from "lucide-react";
import { seatOverrideReasonMax, seatOverrideReasonMin } from "@/modules/honors/admin-placement-limits";

/**
 * System administrators only (#962): the page shows these controls to no one else, and the server refuses everyone else
 * regardless. Placing a youth in a full class never changes the class's seat limit, and every use is audited.
 */

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(result.message ?? "That could not be saved.");
}

const reasonHelp = `A short reason, ${seatOverrideReasonMin} to ${seatOverrideReasonMax} characters. It is saved on the seat and in the audit log and shown on class rosters, so leave out medical and other private details.`;

export type PlacementCandidate = {
  id: string;
  label: string;
  clubId: string;
  clubName: string;
  /** Class changes are closed for this youth's site: a normal pick fails, so a placement into a free seat is a counted seat (#962). */
  changesClosed: boolean;
};

export type PlacementClass = {
  id: string;
  label: string;
  /** Seats counted toward the limit and held for live offers, across every site, subtracted from the limit; above zero, the class still has a seat. */
  seatsLeft: number;
  perClubLimit: number | null;
  /** Seat-taking youth each club holds in the class, placements included. */
  clubSeats: Record<string, number>;
};

export function HonorSeatPlacementForm({
  eventId,
  classes,
  candidates,
}: {
  eventId: string;
  classes: PlacementClass[];
  candidates: PlacementCandidate[];
}) {
  const router = useRouter();
  const [offeringId, setOfferingId] = useState("");
  const [attendeeId, setAttendeeId] = useState("");
  const [reason, setReason] = useState("");
  const [requirementReason, setRequirementReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const chosenClass = classes.find((candidate) => candidate.id === offeringId);
  const chosenYouth = candidates.find((candidate) => candidate.id === attendeeId);
  const valid = attendeeId !== "" && offeringId !== "" && reason.trim().length >= seatOverrideReasonMin
    && (requirementReason.trim() === "" || requirementReason.trim().length >= 3);
  // The same count the server records as clubLimitExceeded: every seat the club holds in the class, placements included.
  const clubLimitWarning = chosenClass && chosenYouth && chosenClass.perClubLimit !== null
    && (chosenClass.clubSeats[chosenYouth.clubId] ?? 0) + 1 > chosenClass.perClubLimit
    ? `${chosenYouth.clubName} would then have ${(chosenClass.clubSeats[chosenYouth.clubId] ?? 0) + 1} youth in a class that allows ${chosenClass.perClubLimit} per club. The placement goes ahead and is recorded as over the club limit.`
    : "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await post(`/api/events/${encodeURIComponent(eventId)}/honors/seat-overrides`, { registrationAttendeeId: attendeeId, offeringId, reason: reason.trim(), ...(requirementReason.trim() ? { overrideReason: requirementReason.trim() } : {}) });
      setAttendeeId("");
      setOfferingId("");
      setReason("");
      setRequirementReason("");
      setMessage("Placed. The class's seat limit did not change.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="honor-seat-override">
      <summary><ShieldAlert aria-hidden="true" size={15} /> Place a youth by hand (system administrators)</summary>
      <form className="form-grid" onSubmit={submit}>
        <p className="field-help">
          This puts the youth in even when the class is full or class changes have closed. It does not change the
          class&apos;s seat limit, anyone&apos;s place on the waitlist, or any seat already offered. The youth still has to meet the class&apos;s age, level and
          prerequisites, and can&apos;t clash with another class in the session.
        </p>
        <label>
          Class
          <select onChange={(event) => setOfferingId(event.target.value)} value={offeringId}>
            <option value="">Choose a class</option>
            {classes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}{candidate.seatsLeft <= 0 ? " (full)" : ""}</option>)}
          </select>
        </label>
        <label>
          Youth
          <select onChange={(event) => setAttendeeId(event.target.value)} value={attendeeId}>
            <option value="">Choose a youth</option>
            {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </label>
        <label>
          Reason
          <input maxLength={seatOverrideReasonMax} onChange={(event) => setReason(event.target.value)} value={reason} />
          <span className="field-help">{reasonHelp}</span>
        </label>
        <label>
          Reason to waive a class level or prerequisite (only if needed)
          <input maxLength={seatOverrideReasonMax} onChange={(event) => setRequirementReason(event.target.value)} value={requirementReason} />
          <span className="field-help">Recorded and audited like staff placing someone who doesn&apos;t meet a class requirement. Age and one class per session are never waived.</span>
        </label>
        {chosenClass && chosenYouth && chosenClass.seatsLeft > 0 && (chosenYouth.changesClosed
          ? <div className="inline-notice" role="status">This class has a seat; placing by hand fills it. Class changes are closed, so it counts like any other seat.</div>
          : <div className="inline-notice" role="status">This class still has a seat, so it can&apos;t be placed by hand. Pick it normally, or accept the youth&apos;s waitlist offer if they have one.</div>)}
        {chosenClass && chosenClass.seatsLeft <= 0 && <div className="inline-notice" role="status">{chosenClass.label} is full.</div>}
        {clubLimitWarning && <div className="inline-notice warning" role="status">{clubLimitWarning}</div>}
        {message && <div className="inline-notice success" role="status">{message}</div>}
        {error && <div className="inline-notice error" role="alert">{error}</div>}
        <button className="secondary-button" disabled={saving || !valid} type="submit">{saving ? "Placing…" : "Place in this class"}</button>
      </form>
    </details>
  );
}

export function HonorPickRemoveButton({ eventId, enrollmentId, who }: { eventId: string; enrollmentId: string; who: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const valid = reason.trim().length >= seatOverrideReasonMin;

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await post(`/api/events/${encodeURIComponent(eventId)}/honors/seat-overrides/${encodeURIComponent(enrollmentId)}/remove`, { reason: reason.trim() });
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button aria-label={`Remove ${who} from this class`} className="secondary-button honor-seat-override" onClick={() => setOpen(true)} type="button">
        <Trash2 aria-hidden="true" size={14} /> Remove
      </button>
    );
  }
  return (
    <form className="honor-seat-override form-grid" onSubmit={remove}>
      <label>
        Reason for removing {who}
        <input maxLength={seatOverrideReasonMax} onChange={(event) => setReason(event.target.value)} value={reason} />
        <span className="field-help">{reasonHelp}</span>
      </label>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <button className="secondary-button" disabled={saving || !valid} type="submit">{saving ? "Removing…" : "Remove pick"}</button>
      <button className="secondary-button" onClick={() => setOpen(false)} type="button">Cancel</button>
    </form>
  );
}
