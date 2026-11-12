import type { ReactNode } from "react";
import { ExactValue, Money } from "@/components/exact-value";
import { formatCents } from "@/modules/payments/format-cents";
import type { BudgetFigures, BudgetTotals, CostLineView, FeePerPerson } from "@/modules/event-budgets/domain";
import styles from "@/components/budget-sheet.module.css";

/**
 * The read-only parts of the Budget sheet (#1682), shared by the editor and by last year's sheet. No hooks: every number
 * arrives already worked out by the same functions Finance and the reports use.
 */

function feeText(fee: FeePerPerson): string {
  if (fee.kind === "uniform") return formatCents(fee.amountCents);
  if (fee.kind === "varies") return `${formatCents(fee.lowCents)} to ${formatCents(fee.highCents)}`;
  return "No price on record";
}

function Row({ label, hint, value, total = false }: { label: string; hint?: string; value: ReactNode; total?: boolean }) {
  return (
    <>
      <dt className={total ? styles.total : undefined}>
        {label}
        {hint && <span className={styles.hint}>{hint}</span>}
      </dt>
      <dd className={total ? styles.total : undefined}>{value}</dd>
    </>
  );
}

export function BudgetFiguresBlock({ figures, headingId }: { figures: BudgetFigures; headingId: string }) {
  const { money, counts } = figures;
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h3 className={styles.heading} id={headingId}>Filled in from registrations</h3>
      <dl className={styles.facts}>
        <Row label="Billed to attendees" value={<Money cents={money.billedCents} />} />
        <Row label="Billed to churches" value={<Money cents={money.churchBilledCents} />} />
        <Row label="Received so far" hint="After refunds, as Finance shows it." value={<Money cents={money.receivedCents} />} />
        <Row label="Still owed" value={<Money cents={money.outstandingCents} />} />
        <Row label="Refunded" value={<Money cents={money.refundedCents} />} />
        <Row label="Paying registrations" hint="Active registrations with a total above zero. A club is one registration." value={figures.payingRegistrations} />
        <Row label="Fee per person" value={<ExactValue>{feeText(figures.feePerPerson)}</ExactValue>} />
        <Row label="Pathfinders" value={counts.pathfinder} />
        <Row label="TLTs" value={counts.tlt} />
        <Row label="Staff" value={counts.staff} />
        <Row label="Children" value={counts.child} />
        <Row label="Total people" hint="As the club event report counts them." value={counts.total} />
        {figures.rooms !== null && <Row label="Rooms available" hint="Rooms set up for this event in Lodging." value={figures.rooms} />}
        {figures.mealsOrdered !== null && <Row label="Meals ordered" hint="All active meal orders for this event." value={figures.mealsOrdered} />}
      </dl>
    </section>
  );
}

export function BudgetTotalsBlock({ totals, headingId }: { totals: BudgetTotals; headingId: string }) {
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h3 className={styles.heading} id={headingId}>Totals</h3>
      <dl className={styles.facts}>
        <Row label="Total income (billed)" hint="Billed to attendees plus billed to churches." value={<Money cents={totals.incomeBilledCents} />} />
        <Row label="Total income (received)" hint="What has come in so far, after refunds." value={<Money cents={totals.incomeReceivedCents} />} />
        <Row label="Total costs" value={<Money cents={totals.costsCents} />} />
        <Row label="Income minus costs (billed)" hint="If everyone pays what is billed." value={<Money cents={totals.netBilledCents} />} total />
        <Row label="Income minus costs (received)" hint="With what has come in so far." value={<Money cents={totals.netReceivedCents} />} total />
      </dl>
    </section>
  );
}

export function BudgetCostLineRow({ line, actions }: { line: CostLineView; actions?: ReactNode }) {
  return (
    <li className={styles.line}>
      <span className={styles.lineLabel}>{line.label}</span>
      <Money className={styles.lineAmount} cents={line.amountCents} />
      {(line.description || line.quantity !== null) && (
        <span className={styles.lineDetails}>
          {line.description}{line.description && line.quantity !== null ? " · " : ""}{line.quantity !== null ? `Quantity ${line.quantity}` : ""}
        </span>
      )}
      {actions}
    </li>
  );
}

export function BudgetCostLinesReadOnly({ lines, headingId }: { lines: readonly CostLineView[]; headingId: string }) {
  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h3 className={styles.heading} id={headingId}>Costs</h3>
      {lines.length === 0 ? <p className={styles.empty}>No costs were added.</p> : (
        <ul className={styles.lines}>
          {lines.map((line) => <BudgetCostLineRow key={line.id} line={line} />)}
        </ul>
      )}
    </section>
  );
}
