"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { submitJson } from "@/lib/submit-json";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import styles from "./leader-directory-switch.module.css";

export type LeaderDirectorySwitchState = { enabled: boolean; setAt: string | null };

/**
 * The conference-wide leader directory switch (#1707) on Platform settings. Saves at once and the server audits each
 * change with the old and new value. Only a system administrator reaches this page; the route checks again.
 */
export function LeaderDirectorySwitch({ initial }: { initial: LeaderDirectorySwitchState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function change(enabled: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await submitJson("/api/admin/platform-settings/leader-directory", { enabled }, { method: "PATCH", init: { cache: "no-store" } });
      const body = response.body as { enabled?: boolean; setAt?: string; message?: string } | null;
      if (!response.ok || typeof body?.enabled !== "boolean") throw new Error(body?.message ?? "The switch could not be changed.");
      setState({ enabled: body.enabled, setAt: body.setAt ?? null });
      setNotice(body.enabled ? "The leader directory is on." : "The leader directory is off.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The switch could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="leader-directory-switch-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow"><Users aria-hidden="true" size={14} /> Leader directory</p>
          <h2 id="leader-directory-switch-heading">Leader directory</h2>
        </div>
      </div>
      <label className={styles.check}>
        <input checked={state.enabled} disabled={busy} onChange={(event) => void change(event.target.checked)} type="checkbox" />
        <span>Leader directory is {state.enabled ? "on" : "off"}</span>
      </label>
      <p className={`field-help ${styles.help}`}>
        Off by default. When on, club directors, deputies and Area Coordinators can see other clubs&apos; leaders. Leaders are listed unless they opt out on their profile.
      </p>
      {state.setAt && <p className={`field-help ${styles.help}`}>Last changed {formatInConferenceTime(state.setAt, { dateStyle: "medium", hour: "numeric", minute: "2-digit" })}.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}
    </section>
  );
}
