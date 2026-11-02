"use client";

import { useState } from "react";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { visibleSessionLimit, visibleSessions } from "@/components/session-list";
import { useConfirm, type ConfirmRequest } from "@/components/use-confirm";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

type SignedInSession = {
  id: string;
  isCurrent: boolean;
  startedAt: string;
  lastSeenAt: string;
  expiresAt?: string;
};

function when(value: string) {
  return formatInConferenceTime(value, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The signed-in devices panel. Staff use it as is; the registration account's list (#221) reuses it with its own
 * endpoint, heading, wording and a confirmation, so both profile sections look and behave the same.
 */
export function SessionManager({
  initialSessions,
  idleTimeoutSeconds,
  endpoint = "/api/auth/sessions",
  method = "DELETE",
  eyebrow = "Your account",
  description,
  signOutLabel,
  confirmRequest,
}: {
  initialSessions: SignedInSession[];
  idleTimeoutSeconds?: number;
  endpoint?: string;
  method?: "DELETE" | "POST";
  eyebrow?: string;
  description?: string;
  /** A fixed button label; the staff default counts the other devices. */
  signOutLabel?: string;
  /** Asks in the shared dialog before signing the others out. */
  confirmRequest?: ConfirmRequest;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [sessions, setSessions] = useState(() => [...initialSessions].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)));
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const others = sessions.filter((session) => !session.isCurrent);

  async function revokeOthers() {
    if (confirmRequest && !(await confirm(confirmRequest))) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, { method });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.sessions)) throw new Error(result.message ?? "Unable to sign out the other devices.");
      setSessions([...(result.sessions as SignedInSession[])].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)));
      setMessage(
        result.revoked === 0
          ? "There were no other signed-in devices."
          : `Signed out ${result.revoked} other device${result.revoked === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign out the other devices.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>Signed-in devices</h2>
        </div>
        <span className="count-badge">
          <MonitorSmartphone aria-hidden="true" size={16} /> {sessions.length} active
        </span>
      </div>
      <p className="quiet-copy">
        {description ?? `A session ends after ${Math.round((idleTimeoutSeconds ?? 0) / 60)} minutes of inactivity, and after 8 hours in any case. Sign out the others if you have left one open on a shared check-in tablet.`}
      </p>
      <div className="activity-list">
        {visibleSessions(sessions, showAll).map((session) => (
          <article className="activity-row" key={session.id}>
            <span className="activity-icon">
              <MonitorSmartphone aria-hidden="true" size={16} />
            </span>
            <span>
              <strong>{session.isCurrent ? "This device" : "Another device"}</strong>
              <small>
                Last active {when(session.lastSeenAt)} · signed in {when(session.startedAt)}
              </small>
            </span>
            {session.isCurrent && <code>current</code>}
          </article>
        ))}
      </div>
      {sessions.length > visibleSessionLimit && (
        <button
          className="secondary-button session-show-all"
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? `Show fewer (${visibleSessionLimit})` : `Show all ${sessions.length}`}
        </button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="quiet-copy" role="status">{message}</p>}
      <button
        className="secondary-button"
        type="button"
        onClick={revokeOthers}
        disabled={busy || others.length === 0}
      >
        <LogOut aria-hidden="true" size={16} />
        {busy ? "Signing out…" : signOutLabel ?? ` Sign out ${others.length} other device${others.length === 1 ? "" : "s"}`}
      </button>
      {confirmDialog}
    </section>
  );
}
