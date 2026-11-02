"use client";

import { useState } from "react";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { useConfirm } from "@/components/use-confirm";
import styles from "@/components/attendee-session-manager.module.css";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export type AttendeeSignedInSession = {
  id: string;
  isCurrent: boolean;
  startedAt: string;
  lastSeenAt: string;
};

const signedIn = (value: string) => formatInConferenceTime(value, { dateStyle: "medium" });
/** Central, with the zone named ("CST"), as every time on the site (B13). */
const lastActive = (value: string) => formatInConferenceTime(value, { dateStyle: "medium", timeStyle: "short" });

/**
 * "Signed-in devices" in the security section of the profile (#221): this account's active sessions, and one
 * button that signs out every other one. A browser's user agent is only stored as a hash, so a device is never
 * given a name; the one in front of the person is marked "This device".
 */
export function AttendeeSessionManager({ initialSessions }: { initialSessions: AttendeeSignedInSession[] }) {
  const { confirm, confirmDialog } = useConfirm();
  const [sessions, setSessions] = useState(initialSessions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const others = sessions.filter((session) => !session.isCurrent);

  async function signOutOthers() {
    const confirmed = await confirm({
      title: "Sign out everywhere else?",
      body: "Every other phone, tablet and computer signed in to this account will be signed out. This device stays signed in.",
      confirmLabel: "Sign out everywhere else",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/attendee/sessions/sign-out-others", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "Your other devices could not be signed out.");
      setSessions(result.sessions ?? sessions.filter((session) => session.isCurrent));
      setMessage(
        result.revoked === 0
          ? "There were no other signed-in devices."
          : `Signed out ${result.revoked} other device${result.revoked === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your other devices could not be signed out.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="attendee-sessions-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Account security</p>
          <h2 id="attendee-sessions-heading">Signed-in devices</h2>
        </div>
        <span className="count-badge">
          <MonitorSmartphone aria-hidden="true" size={16} /> {sessions.length} signed in
        </span>
      </div>
      <p className="quiet-copy">
        Signed in somewhere you no longer use, or on a phone you lost? Sign out everywhere else. This device stays signed in.
      </p>
      <ul className={styles.list}>
        {sessions.map((session) => (
          <li className={styles.row} key={session.id}>
            <strong>{session.isCurrent ? "This device" : "Another device"}</strong>
            <span className={styles.detail}>Signed in {signedIn(session.startedAt)}</span>
            <span className={styles.detail}>Last active {lastActive(session.lastSeenAt)}</span>
          </li>
        ))}
      </ul>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className={styles.status} role="status">{message}</p>}
      <button className={`secondary-button ${styles.action}`} type="button" onClick={signOutOthers} disabled={busy || others.length === 0}>
        <LogOut aria-hidden="true" size={16} />
        {busy ? "Signing out…" : "Sign out everywhere else"}
      </button>
      {confirmDialog}
    </section>
  );
}
