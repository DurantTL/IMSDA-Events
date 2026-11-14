import { EmptyState } from "@/components/empty-state";
import { ProfileAccountSearch } from "@/components/profile-account-search";
import { ProfileCorrectionForm } from "@/components/profile-correction-form";
import styles from "@/components/profile-updates-review.module.css";
import { ProfilePersonalCorrectionForm } from "@/components/profile-personal-correction-form";
import type { StaffCorrectableAccount, StaffProfileChange, StaffProfileChangeSlice } from "@/modules/attendee-accounts/profile-change-staff";
import { ListPager } from "@/components/list-pager";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

function describeChange(change: StaffProfileChange) {
  if (change.oldValue === null && change.newValue === null) return `${change.fieldLabel}: changed`;
  return `${change.fieldLabel}: ${change.oldValue ?? "(empty)"} → ${change.newValue ?? "(empty)"}`;
}

/**
 * One page of attendee profile changes (#1512), newest first. Name, phone and shirt size show old and new values, and so
 * does a staff correction of address or emergency contact. The current address and emergency contact are not loaded
 * here: each account's correction fetches them only when it is opened.
 */
export function ProfileUpdatesReview({ changes, accounts, slice }: { changes: StaffProfileChange[]; accounts: StaffCorrectableAccount[]; slice: StaffProfileChangeSlice }) {
  const pageHref = (target: number) => (target <= 1 ? "/people/profile-updates" : `/people/profile-updates?page=${target}`);
  if (changes.length === 0) {
    return (
      <div className={styles.stack}>
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
        <ProfileAccountSearch />
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      <section className={styles.section} aria-labelledby="profile-changes-heading">
        <h2 id="profile-changes-heading" className={styles.sectionTitle}>Recent changes</h2>
        <ListPager hrefFor={pageHref} label="Profile change pages" noun="changes" nounOne="change" part="count" slice={slice} />
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
        <ListPager hrefFor={pageHref} label="Profile change pages" part="pages" slice={slice} />
      </section>
      <section className={styles.section} aria-labelledby="profile-corrections-heading">
        <h2 id="profile-corrections-heading" className={styles.sectionTitle}>Correct a profile</h2>
        <ul className={styles.list}>
          {accounts.map((account) => (
            <li key={account.accountId} className={styles.card}>
              <h3 className={styles.cardTitle} translate="no">{account.accountName}</h3>
              <ProfileCorrectionForm accountId={account.accountId} current={account.current} />
              <ProfilePersonalCorrectionForm accountId={account.accountId} />
            </li>
          ))}
        </ul>
      </section>
      <ProfileAccountSearch />
    </div>
  );
}
