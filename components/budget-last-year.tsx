import { BudgetCostLinesReadOnly, BudgetFiguresBlock, BudgetTotalsBlock } from "@/components/budget-sheet-view";
import type { CarriedBudget } from "@/modules/event-budgets/domain";
import styles from "@/components/budget-sheet.module.css";

/** Last year's sheet (#1682), read only, for an event that was copied from another. Says so plainly when the source kept no sheet. */
export function BudgetLastYear({ carried }: { carried: CarriedBudget }) {
  if (carried.kind === "none") return null;
  return (
    <section className={styles.lastYear} aria-labelledby="budget-last-year">
      <h2 className={styles.heading} id="budget-last-year">Last year: <span translate="no">{carried.sourceEventName}</span></h2>
      {carried.kind === "no-sheet" ? (
        <p className={styles.empty}>No budget sheet was kept for last year&apos;s event.</p>
      ) : (
        <>
          <p className={styles.note}>Read only. These are last year&apos;s figures as they stand today.</p>
          <BudgetFiguresBlock figures={carried.sheet.figures} headingId="budget-last-figures" />
          <BudgetCostLinesReadOnly headingId="budget-last-costs" lines={carried.sheet.costLines} />
          <BudgetTotalsBlock headingId="budget-last-totals" totals={carried.sheet.totals} />
        </>
      )}
    </section>
  );
}
