"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reportMonthLabel } from "@/modules/club-reports/domain";
import type { MonthlyRecordReminderLogRow } from "@/modules/club-reports/monthly-reminders";
import styles from "./monthly-record-reminders.module.css";

/**
 * The automatic Monthly Record reminder (#1895), for Clubs Administrators and system administrators: the switch for the
 * current club year and the log of what went out (month, club, how many people, when). No address or name is shown.
 * The page and the route check access again; this only draws what they hand it.
 */
export function MonthlyRecordReminders({
  clubYear,
  enabled,
  log,
  sentAtLabels,
}: {
  clubYear: string;
  enabled: boolean;
  log: MonthlyRecordReminderLogRow[];
  /** Each row's sent time, already formatted in conference time by the server (same order as `log`). */
  sentAtLabels: string[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function change(next: boolean) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/club-reports/monthly-reminders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setError(result.message ?? "The change could not be saved.");
        return;
      }
      router.refresh();
    } catch {
      setError("The change could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="monthly-reminders-heading" className={styles.card} data-testid="monthly-record-reminders" id="monthly-record-reminders">
      <h2 className={styles.heading} id="monthly-reminders-heading">Monthly Record reminders</h2>
      <p className={styles.note}>
        On the 11th of each month, the director and deputy of each club that has not submitted last month&apos;s record get one email with a link to the record. Area Coordinators get a summary of counts only.
      </p>
      <div className={styles.switchRow}>
        <span className={styles.state} data-testid="reminder-state">{`Reminders are ${enabled ? "on" : "off"} for ${clubYear}.`}</span>
        <button className={enabled ? "secondary-button" : "primary-button"} disabled={saving} onClick={() => void change(!enabled)} type="button">
          {enabled ? "Turn off" : "Turn on"}
          <span className="sr-only">{` the Monthly Record reminders for ${clubYear}`}</span>
        </button>
      </div>
      {error && <p className={styles.problem} role="alert">{error}</p>}
      {log.length === 0 ? (
        <p className={styles.note}>No reminders have been sent yet.</p>
      ) : (
        <table className={styles.table}>
          <caption className="sr-only">Reminders sent, newest first</caption>
          <thead>
            <tr><th scope="col">Month</th><th scope="col">Club</th><th scope="col">People emailed</th><th scope="col">Sent</th></tr>
          </thead>
          <tbody>
            {log.map((row, index) => (
              <tr key={row.id}>
                <td data-label="Month">{reportMonthLabel(row.reportMonth)}</td>
                <td className={styles.club} data-label="Club">{row.clubName}</td>
                <td className={styles.number} data-label="People emailed">{row.recipients}</td>
                <td data-label="Sent">{sentAtLabels[index]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
