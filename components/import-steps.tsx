import styles from "./import-steps.module.css";

export const importSteps = ["Preview", "Review", "Results"] as const;
export type ImportStep = (typeof importSteps)[number];

/**
 * The three steps of a file import, with the current one marked (#1589). Done and upcoming steps say so in
 * words, so the state never depends on colour alone.
 */
export function ImportSteps({ current }: { current: ImportStep }) {
  const at = importSteps.indexOf(current);
  return (
    <ol aria-label="Import steps" className={styles.steps}>
      {importSteps.map((step, index) => (
        <li aria-current={index === at ? "step" : undefined} className={index === at ? `${styles.step} ${styles.current}` : styles.step} key={step}>
          <span className={styles.number} aria-hidden="true">{index + 1}</span>
          <span>{step}</span>
          <span aria-hidden={index === at ? "true" : undefined} className={styles.state}>{index < at ? "(done)" : index === at ? "(current step)" : "(next)"}</span>
        </li>
      ))}
    </ol>
  );
}
