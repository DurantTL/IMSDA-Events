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

export type PlacementCandidate = { id: string; label: string };

export type PlacementClass = { id: string; label: string; seatsLeft: number };

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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const chosenClass = classes.find((candidate) => candidate.id === offeringId);
  const valid = attendeeId !== "" && offeringId !== "" && reason.trim().length >= seatOverrideReasonMin;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await post(`/api/events/${encodeURIComponent(eventId)}/honors/seat-overrides`, { registrationAttendeeId: attendeeId, offeringId, reason: reason.trim() });
      setAttendeeId("");
      setOfferingId("");
      setReason("");
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
          {chosenClass && chosenClass.seatsLeft <= 0 ? `${chosenClass.label} is full. ` : ""}This puts the youth in even when the class is full or class changes have closed. It does not change the
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
