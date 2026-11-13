import { EmptyState } from "@/components/empty-state";
import { ProfileCorrectionForm } from "@/components/profile-correction-form";
import styles from "@/components/profile-updates-review.module.css";
import { PROFILE_CHANGE_LIST_LIMIT, type StaffCorrectableAccount, type StaffProfileChange } from "@/modules/attendee-accounts/profile-change-staff";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

function describeChange(change: StaffProfileChange) {
  if (change.oldValue === null && change.newValue === null) return `${change.fieldLabel}: changed`;
  return `${change.fieldLabel}: ${change.oldValue ?? "(empty)"} → ${change.newValue ?? "(empty)"}`;
}

/**
 * The newest attendee profile changes (#1512). Name, phone and shirt size show old and new values; any other field only
 * shows that it changed, because its values are never kept.
 */
export function ProfileUpdatesReview({ changes, accounts, capped }: { changes: StaffProfileChange[]; accounts: StaffCorrectableAccount[]; capped: boolean }) {
  if (changes.length === 0) {
    return (
      <EmptyState
        action={{ label: "Back to people", href: "/people" }}
        actionClass="secondary-button"
        canCreate
        className="empty-state panel"
        headingLevel={2}
        title="No profile changes yet"
      >
        Changes appear here when an attendee edits their saved profile or updates it from a registration. Nothing needs your attention now.
      </EmptyState>
    );
  }
  return (
    <div className={styles.stack}>
      <section className={styles.section} aria-labelledby="profile-changes-heading">
        <h2 id="profile-changes-heading" className={styles.sectionTitle}>Recent changes</h2>
        <p className={styles.meta}>
          {capped ? `Showing the latest ${PROFILE_CHANGE_LIST_LIMIT} changes, newest first.` : `Showing all ${changes.length} ${changes.length === 1 ? "change" : "changes"}, newest first.`}
        </p>
        <ol className={styles.list}>
          {changes.map((change) => (
            <li key={change.id} className={styles.card}>
              <h3 className={styles.cardTitle} translate="no">{change.accountName}</h3>
              <p className={styles.change} translate="no">{describeChange(change)}</p>
              <p className={styles.meta}>
                {formatInConferenceTime(change.createdAt, { dateStyle: "medium", timeStyle: "short" })} · {change.sourceLabel}
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
