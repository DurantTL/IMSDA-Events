import Link from "next/link";
import styles from "@/components/two-step-recovery-link.module.css";
import { twoStepRecoveryPathFor } from "@/modules/attendee-accounts/return-destination";

/** The way out for a lost phone or security key (#221), on the "Confirm it's you" page and in account settings. */
export function TwoStepRecoveryLink({ next }: { next?: string | null }) {
  return (
    <p className={styles.wrap}>
      <Link className={styles.link} href={twoStepRecoveryPathFor(next)}>
        Lost your phone or security key? Recover two-step sign-in
      </Link>
    </p>
  );
}
