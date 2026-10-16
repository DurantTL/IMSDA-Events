import Link from "next/link";

/**
 * Teams registered through the general registration link (#931) that wait for staff to confirm the club are not registrations
 * yet, so the Registrations page says so at the top: an unmatched team must never look like it vanished. Shown only to
 * someone who can resolve them (MANAGE_REGISTRATION) and only while one is waiting.
 */
export function pendingTeamsLabel(count: number) {
  return `${count} ${count === 1 ? "team" : "teams"} waiting for a club`;
}

export function PendingTeamsNotice({ count, eventId, canManage }: { count: number; eventId: string; canManage: boolean }) {
  if (!canManage || count <= 0) return null;
  return (
    <div className="inline-notice warning pending-teams-notice" role="status">
      <strong>{pendingTeamsLabel(count)}.</strong>{" "}
      They are not registrations until staff confirm the club.{" "}
      <Link className="text-button" href={`/people/pending-teams?event=${encodeURIComponent(eventId)}`}>Review them</Link>
    </div>
  );
}
