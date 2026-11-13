"use client";

import { MonthlyRecordSwitch } from "@/components/monthly-record-switch";
import styles from "./monthly-record-reminders.module.css";

/** The on/off switch of the automatic Monthly Record reminder (#1895), on the shared switch. */
export function MonthlyRecordReminderSwitch({ clubYear, enabled, started, turnOnNote }: { clubYear: string; enabled: boolean; started: boolean; turnOnNote: string }) {
  return (
    <MonthlyRecordSwitch
      buttonSuffix={` the Monthly Record reminders for ${clubYear}`}
      enabled={enabled}
      endpoint="/api/admin/club-reports/monthly-reminders"
      savedOff={`Reminders are off for ${clubYear}. Nothing will be sent until you turn them back on.`}
      savedOn={`Reminders are on for ${clubYear}.`}
      stateTestId="reminder-state"
      stateText={enabled ? `Reminders are on for ${clubYear}.` : started ? `Reminders are off for ${clubYear}.` : "Reminders are off. They haven't been turned on yet."}
    >
      {!enabled && turnOnNote && <p className={styles.note}>{turnOnNote}</p>}
      {enabled && <p className={styles.note}>Turning off applies to {clubYear} only. Once started, each new club year starts on.</p>}
    </MonthlyRecordSwitch>
  );
}
