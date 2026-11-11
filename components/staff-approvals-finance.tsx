import styles from "@/components/staff-approvals-finance.module.css";
import { formatCents } from "@/modules/payments/format-cents";
import type { StaffApprovalFinanceRow } from "@/modules/staff-invitations/finance-approvals";

const GROUP_LABEL: Record<StaffApprovalFinanceRow["group"], string> = { STAFF: "Staff", PASTOR: "Pastor", VOLUNTEER: "Volunteer" };

function approvedOn(iso: string | null) {
  if (!iso) return "Not recorded";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Every staff, pastor or volunteer registration the office approved, with the conference-paid meals recorded on it, so the
 * finance office sees what the conference is covering and who agreed to it.
 */
export function StaffApprovalsFinance({ rows, totals }: { rows: readonly StaffApprovalFinanceRow[]; totals: { approvals: number; conferenceMeals: number; conferenceMealCents: number } }) {
  return (
    <section aria-labelledby="staff-approvals-heading" className={styles.section} data-testid="staff-approvals-finance">
      <h2 className={styles.heading} id="staff-approvals-heading">Staff approvals with conference-paid meals</h2>
      <p className={styles.note}>
        {rows.length === 0
          ? "No staff, pastor or volunteer registrations have been approved for this event."
          : `${totals.approvals} approved. ${totals.conferenceMeals} conference-paid ${totals.conferenceMeals === 1 ? "meal" : "meals"} recorded, worth ${formatCents(totals.conferenceMealCents)} at the conference rate.`}
      </p>
      {rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li className={styles.row} key={row.id}>
              <p className={styles.field}><span className={styles.label}>Worker</span><span className={styles.value} translate="no">{row.worker || row.confirmationCode}</span></p>
              <p className={styles.field}><span className={styles.label}>Group</span><span className={styles.value}>{GROUP_LABEL[row.group]}</span></p>
              <p className={styles.field}><span className={styles.label}>Approved by</span><span className={styles.value} translate="no">{row.approvedBy ?? "Not recorded"}</span></p>
              <p className={styles.field}><span className={styles.label}>Approved on</span><span className={styles.value}>{approvedOn(row.decidedAt)}</span></p>
              <p className={styles.field}><span className={styles.label}>Conference-paid meals</span><span className={styles.value}>{row.conferenceMeals === 0 ? "None recorded" : `${row.conferenceMeals} (${formatCents(row.conferenceMealCents)})`}</span></p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
