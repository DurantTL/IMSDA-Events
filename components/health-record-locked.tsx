import { BackLink } from "@/components/back-link";
import { ExactValue } from "@/components/exact-value";
import styles from "./health-record-locked.module.css";

/**
 * Shown in place of a health record while the personal-data key is unavailable (#1652). Nothing is lost and
 * nothing is shown: the record opens again by itself once the key loads. The member's name and the way back stay,
 * because they are not protected. No value, key or reason code is shown.
 */
export function HealthRecordLocked({ memberName, back }: { memberName?: string; back?: { href: string; label: string } }) {
  return (
    <section className="page-stack club-form-page">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <header>
        <h2 className={styles.heading}>
          {memberName ? <>Health record: <ExactValue>{memberName}</ExactValue> is locked right now</> : "Health records are locked right now"}
        </h2>
      </header>
      <p className={`quiet-copy ${styles.note}`}>
        Locked: the personal-data key is unavailable right now. Nothing has been lost. Try again in a few minutes. If it
        stays locked, tell a system administrator.
      </p>
    </section>
  );
}
