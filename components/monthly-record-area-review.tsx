import { MonthlyRecordSwitch } from "@/components/monthly-record-switch";
import styles from "./monthly-record-reminders.module.css";

/**
 * The conference switch for Area Coordinator review of Monthly Records (#1701), for Clubs Administrators and system
 * administrators. Off by default. The route checks access again.
 */
export function MonthlyRecordAreaReview({ clubYear, enabled }: { clubYear: string; enabled: boolean }) {
  return (
    <section aria-labelledby="monthly-area-review-heading" className={`${styles.card} ${styles.spaced}`} data-testid="monthly-record-area-review" id="monthly-record-area-review">
      <h2 className={styles.heading} id="monthly-area-review-heading">Area Coordinator review</h2>
      <p className={styles.note}>
        Optional. When on, an Area Coordinator can mark each item of a submitted Monthly Record OK or Returned with a note. A club with a returned item can change it and submit again, even after the due date. Staff review works the same either way.
      </p>
      <MonthlyRecordSwitch
        buttonSuffix={` Area Coordinator review for ${clubYear}`}
        enabled={enabled}
        endpoint="/api/admin/club-reports/monthly-area-review"
        savedOff={`Area Coordinator review is off for ${clubYear}.`}
        savedOn={`Area Coordinator review is on for ${clubYear}.`}
        stateTestId="area-review-state"
        stateText={enabled ? `Area Coordinator review is on for ${clubYear}.` : `Area Coordinator review is off for ${clubYear}.`}
      >
        <p className={styles.note}>This applies to {clubYear} only. Turning it off ends any returns in progress; staff then change those records themselves.</p>
      </MonthlyRecordSwitch>
    </section>
  );
}
