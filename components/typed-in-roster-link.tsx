"use client";

import { useState } from "react";

/**
 * An optional link from a team member typed in through the general registration link (#931) to someone on the club's roster.
 * It changes nothing about the registration; it only records which roster member this person is.
 */
export function TypedInRosterLink({
  organizationId,
  eventId,
  attendeeId,
  initialRosterMemberId,
  options,
}: {
  organizationId: string;
  eventId: string;
  attendeeId: string;
  initialRosterMemberId: string | null;
  options: Array<{ id: string; name: string }>;
}) {
  const [saved, setSaved] = useState(initialRosterMemberId ?? "");
  const [choice, setChoice] = useState(initialRosterMemberId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/registration/roster-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeId, rosterMemberId: choice || null }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        setMessage(result.message ?? "That couldn't be saved.");
        return;
      }
      setSaved(choice);
      setMessage(choice ? "Linked to your roster." : "Link removed.");
    } catch {
      setMessage("We couldn't reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="field-help typed-in-roster-link">
      <label>
        <span>Link to your roster (optional)</span>
        <select disabled={busy} onChange={(event) => setChoice(event.target.value)} value={choice}>
          <option value="">Not linked</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>
      <button className="text-button" disabled={busy || choice === saved} onClick={() => void save()} type="button">Save link</button>
      {message && <small role="status"> {message}</small>}
    </span>
  );
}
