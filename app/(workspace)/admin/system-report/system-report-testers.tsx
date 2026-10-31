import { EmailTesterCard } from "./email-tester-card";
import { SquareTesterCard } from "./square-tester-card";
import styles from "./testers.module.css";

/** The two testers (#1383), side by side under the at-a-glance card. */
export function SystemReportTesters({ defaultEmail }: { defaultEmail: string }) {
  return (
    <div className={styles.testers} data-testid="system-report-testers">
      <EmailTesterCard defaultEmail={defaultEmail} />
      <SquareTesterCard />
    </div>
  );
}
