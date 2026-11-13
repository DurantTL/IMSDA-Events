import { ProfileCorrectionForm } from "@/components/profile-correction-form";
import styles from "@/components/profile-updates-review.module.css";
import type { StaffCorrectableAccount, StaffProfileChange } from "@/modules/attendee-accounts/profile-change-staff";

const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

function describeChange(change: StaffProfileChange) {
  if (change.oldValue === null && change.newValue === null) return `${change.fieldLabel}: changed`;
  return `${change.fieldLabel}: ${change.oldValue ?? "(empty)"} → ${change.newValue ?? "(empty)"}`;
}

/**
 * The newest attendee profile changes (#1512). Name, phone and shirt size show old and new values; any other field only
 * shows that it changed, because its values are never kept.
 */
export function ProfileUpdatesReview({ changes, accounts }: { changes: StaffProfileChange[]; accounts: StaffCorrectableAccount[] }) {
  if (changes.length === 0) {
    return <p className={styles.empty}>No attendee has changed their saved profile yet.</p>;
  }
  return (
    <div className={styles.stack}>
      <section className={styles.section} aria-labelledby="profile-changes-heading">
        <h2 id="profile-changes-heading" className={styles.sectionTitle}>Recent changes</h2>
        <ol className={styles.list}>
          {changes.map((change) => (
            <li key={change.id} className={styles.card}>
              <h3 className={styles.cardTitle} translate="no">{change.accountName}</h3>
              <p className={styles.change} translate="no">{describeChange(change)}</p>
              <p className={styles.meta}>
                {when.format(new Date(change.createdAt))} UTC · {change.sourceLabel}
                {change.confirmationCode ? <> · Registration <span translate="no">{change.confirmationCode}</span></> : null}
              </p>
              {change.reason ? <p className={styles.meta}>Reason: {change.reason}</p> : null}
            </li>
          ))}
        </ol>
      </section>
      <section className={styles.section} aria-labelledby="profile-corrections-heading">
        <h2 id="profile-corrections-heading" className={styles.sectionTitle}>Correct a profile</h2>
        <ul className={styles.list}>
          {accounts.map((account) => (
            <li key={account.accountId} className={styles.card}>
              <h3 className={styles.cardTitle} translate="no">{account.accountName}</h3>
              <ProfileCorrectionForm accountId={account.accountId} current={account.current} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
