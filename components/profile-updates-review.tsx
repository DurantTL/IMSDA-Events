import { EmptyState } from "@/components/empty-state";
import { ProfileCorrectionForm } from "@/components/profile-correction-form";
import styles from "@/components/profile-updates-review.module.css";
import { ProfilePersonalCorrectionForm } from "@/components/profile-personal-correction-form";
import { PROFILE_CHANGE_LIST_LIMIT, type StaffCorrectableAccount, type StaffProfileChange } from "@/modules/attendee-accounts/profile-change-staff";
import { NavigationLink as Link } from "@/components/navigation-link";
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
export function ProfileUpdatesReview({ changes, accounts, page, hasOlder, hasNewer }: { changes: StaffProfileChange[]; accounts: StaffCorrectableAccount[]; page: number; hasOlder: boolean; hasNewer: boolean }) {
  const pageHref = (target: number) => (target <= 1 ? "/people/profile-updates" : `/people/profile-updates?page=${target}`);
  if (changes.length === 0 && page > 1) {
    return (
      <p className={styles.meta}>
        There are no changes on this page. <Link href={pageHref(1)}>Back to the newest changes</Link>
      </p>
    );
  }
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
          {hasOlder || hasNewer
            ? `Page ${page}: up to ${PROFILE_CHANGE_LIST_LIMIT} changes, newest first.`
            : `All ${changes.length} ${changes.length === 1 ? "change" : "changes"}, newest first.`}
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
        {hasOlder || hasNewer ? (
          <nav className={styles.paging} aria-label="Pages of changes">
            {hasNewer ? <Link className="secondary-button" href={pageHref(page - 1)}>Newer changes</Link> : null}
            {hasOlder ? <Link className="secondary-button" href={pageHref(page + 1)}>Older changes</Link> : null}
          </nav>
        ) : null}
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
    </div>
  );
}
