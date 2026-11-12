"use client";

import Link from "next/link";
import { useState } from "react";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { useTableSort, type SortSpec } from "@/components/use-table-sort";
import { paginate } from "@/lib/pagination";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { formatCents } from "@/modules/payments/format-cents";
import type { StaffApprovalFinanceRow } from "@/modules/staff-invitations/finance-approvals";

const GROUP_LABEL: Record<StaffApprovalFinanceRow["group"], string> = { STAFF: "Staff", PASTOR: "Pastor", VOLUNTEER: "Volunteer" };
const PAGE_SIZE = 25;

const SORT_SPEC: Record<"worker" | "group" | "approvedBy" | "approvedOn" | "meals", SortSpec<StaffApprovalFinanceRow>> = {
  worker: { label: "Worker", value: (row) => row.worker || row.confirmationCode },
  group: { label: "Group", value: (row) => GROUP_LABEL[row.group] },
  approvedBy: { label: "Approved by", value: (row) => row.approvedBy ?? "" },
  approvedOn: { label: "Approved on", kind: "date", value: (row) => row.decidedAt ?? "" },
  meals: { label: "Conference-paid meals", kind: "number", value: (row) => row.conferenceMeals },
};

function approvedOn(iso: string | null) {
  if (!iso) return "Not recorded";
  return formatInConferenceTime(iso, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Every staff, pastor or volunteer registration the office approved, with the conference-paid meals recorded on it (none
 * when it was approved without meal coverage), so the finance office sees what the conference is covering and who agreed.
 */
export function StaffApprovalsFinance({ eventId, rows, totals }: { eventId: string; rows: readonly StaffApprovalFinanceRow[]; totals: { approvals: number; conferenceMeals: number; conferenceMealCents: number } }) {
  const [page, setPage] = useState(1);
  const sorted = useTableSort(rows, SORT_SPEC, "staffApprovals", { onChange: () => setPage(1) });
  const slice = paginate(sorted.rows, page, PAGE_SIZE);
  return (
    <section aria-labelledby="staff-approvals-heading" className="panel" data-testid="staff-approvals-finance">
      <div className="section-heading">
        <div>
          <h2 id="staff-approvals-heading">Staff approvals and conference-paid meals</h2>
          <p>
            {rows.length === 0
              ? "No staff, pastor or volunteer registrations have been approved for this event."
              : `${totals.approvals} approved. ${totals.conferenceMeals} conference-paid ${totals.conferenceMeals === 1 ? "meal" : "meals"} recorded, worth ${formatCents(totals.conferenceMealCents)} at the conference rate.`}
          </p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p><Link href={`/people/staff-invitations/approvals?event=${encodeURIComponent(eventId)}`}>Open staff invitation approvals</Link> to approve registrations that are waiting.</p>
      ) : (
        <div className="report-table-wrap">
          {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
          <ListPager label="Staff approvals pages" noun="approvals" nounOne="approval" onPage={setPage} part="count" slice={slice} />
          <table className="report-table table-cards">
            <caption className="sr-only">Approved staff, pastor and volunteer registrations with their conference-paid meals</caption>
            <thead>
              <tr>
                {sorted.header("worker")}
                {sorted.header("group")}
                {sorted.header("approvedBy")}
                {sorted.header("approvedOn")}
                {sorted.header("meals")}
              </tr>
            </thead>
            <tbody>
              {slice.items.map((row) => (
                <tr key={row.id}>
                  <th scope="row" translate="no" {...cardCell("Worker")}>{row.worker || row.confirmationCode}</th>
                  <td {...cardCell("Group")}>{GROUP_LABEL[row.group]}</td>
                  <td translate="no" {...cardCell("Approved by")}>{row.approvedBy ?? "Not recorded"}</td>
                  <td {...cardCell("Approved on")}>{approvedOn(row.decidedAt)}</td>
                  <td {...cardCell("Conference-paid meals")}>{row.conferenceMeals === 0 ? "None recorded" : `${row.conferenceMeals} (${formatCents(row.conferenceMealCents)})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ListPager label="Staff approvals pages" noun="approvals" nounOne="approval" onPage={setPage} part="pages" slice={slice} />
        </div>
      )}
    </section>
  );
}
