"use client";

import Link from "next/link";
import { Eye } from "lucide-react";
import { ResendOutingButton } from "@/components/club-outing-actions";
import { SortOrderNote, SortableHeader, useAddressSort } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { sortOrderText, sortRows, type SortKind, type SortState, type SortValue } from "@/lib/list-sort";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { outingLinkStateLabel } from "@/modules/club-forms/outing-domain";
import type { OutingListRow, OutingTracking } from "@/modules/club-forms/outings";

/** The director's outing lists (#1672): every outing on the Forms tab, and who has signed on one outing's page. */

function formatDate(value: string | null) {
  return value ? formatInConferenceTime(value, { month: "short", day: "numeric", year: "numeric" }) : "";
}

const emailDeliveryLabel = {
  QUEUED: "Sending",
  SENT: "Sent",
  DELIVERED: "Delivered",
  NOT_DELIVERED: "Not delivered: send it again",
  UNKNOWN: "",
} as const;

const LIST_COLUMNS = ["activity", "date", "signed", "status"] as const;
type ListColumn = typeof LIST_COLUMNS[number];
const NO_LIST_SORT: SortState<ListColumn> = { key: null, dir: "asc" };
const listAccessors: Record<ListColumn, (row: OutingListRow) => SortValue> = {
  activity: (row) => row.activity,
  date: (row) => row.dateLabel,
  signed: (row) => row.counts.SIGNED,
  status: (row) => row.status,
};
const LIST_LABELS: Record<ListColumn, { label: string; kind: SortKind }> = {
  activity: { label: "activity", kind: "text" }, date: { label: "date", kind: "text" }, signed: { label: "signed count", kind: "number" }, status: { label: "outing status", kind: "text" },
};

export function OutingListTable({ outings, base }: { outings: OutingListRow[]; base: string }) {
  const sort = useAddressSort(LIST_COLUMNS, NO_LIST_SORT, undefined, "outings");
  const rows = sort.key ? sortRows(outings, sort.key, sort.dir, listAccessors) : outings;
  const header = (column: ListColumn, label: string) => <SortableHeader active={sort.key === column} direction={sort.dir} label={label} onSort={() => sort.toggle(column)} />;
  return (
    <div className="report-table-wrap">
      {sort.key && <SortOrderNote>{sortOrderText(LIST_LABELS[sort.key].label, sort.dir, LIST_LABELS[sort.key].kind)}</SortOrderNote>}
      <table className="report-table table-cards" role="table">
        <caption className="sr-only">Outing permission slips</caption>
        <thead role="rowgroup">
          <tr role="row">{header("activity", "Outing")}{header("date", "Date")}{header("signed", "Signed")}<th role="columnheader" scope="col">Not yet</th><th role="columnheader" scope="col">Link expired</th>{header("status", "Status")}<th role="columnheader" scope="col"><span className="sr-only">Open</span></th></tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={row.id} role="row">
              <th role="rowheader" scope="row" translate="no">{row.activity}</th>
              <td {...cardCell("Date")}>{row.dateLabel}</td>
              <td {...cardCell("Signed")}>{row.counts.SIGNED}</td>
              <td {...cardCell("Not yet")}>{row.counts.NOT_YET}</td>
              <td {...cardCell("Link expired")}>{row.counts.EXPIRED}</td>
              <td {...cardCell("Status")}>{row.status === "OPEN" ? "Open" : "Closed"}</td>
              <td {...cardCell(null)}><Link className="secondary-button" href={`${base}/outings/${row.id}`}><Eye aria-hidden="true" size={13} /> Open<span className="sr-only"> {row.activity}, {row.dateLabel}</span></Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TRACK_COLUMNS = ["name", "state", "sent", "when"] as const;
type TrackColumn = typeof TRACK_COLUMNS[number];
const NO_TRACK_SORT: SortState<TrackColumn> = { key: null, dir: "asc" };
type TrackRow = OutingTracking["members"][number];
const trackAccessors: Record<TrackColumn, (row: TrackRow) => SortValue> = {
  name: (row) => row.name,
  state: (row) => outingLinkStateLabel[row.state],
  sent: (row) => row.sentAt,
  when: (row) => row.signedAt ?? row.expiresAt,
};
const TRACK_LABELS: Record<TrackColumn, { label: string; kind: SortKind }> = {
  name: { label: "member", kind: "text" }, state: { label: "signing status", kind: "text" }, sent: { label: "date sent", kind: "date" }, when: { label: "signed or expires date", kind: "date" },
};

export function OutingTrackingTable({ organizationId, outingId, members, base, open }: { organizationId: string; outingId: string; members: TrackRow[]; base: string; open: boolean }) {
  const sort = useAddressSort(TRACK_COLUMNS, NO_TRACK_SORT, undefined, "signing");
  const rows = sort.key ? sortRows(members, sort.key, sort.dir, trackAccessors) : members;
  const header = (column: TrackColumn, label: string) => <SortableHeader active={sort.key === column} direction={sort.dir} label={label} onSort={() => sort.toggle(column)} />;
  return (
    <div className="report-table-wrap">
      {sort.key && <SortOrderNote>{sortOrderText(TRACK_LABELS[sort.key].label, sort.dir, TRACK_LABELS[sort.key].kind)}</SortOrderNote>}
      <table className="report-table table-cards" role="table">
        <caption className="sr-only">Who has signed this outing&apos;s permission slip</caption>
        <thead role="rowgroup">
          <tr role="row">{header("name", "Member")}{header("state", "Slip")}{header("sent", "Sent")}{header("when", "Signed or expires")}<th role="columnheader" scope="col">Email</th><th role="columnheader" scope="col"><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={row.memberId} role="row">
              <th role="rowheader" scope="row" translate="no">{row.name}</th>
              <td {...cardCell("Slip")}>{outingLinkStateLabel[row.state]}</td>
              <td {...cardCell("Sent")}>{formatDate(row.sentAt)}</td>
              <td {...cardCell("Signed or expires")}>{row.state === "SIGNED" ? `Signed ${formatDate(row.signedAt)}` : row.state === "EXPIRED" ? `Expired ${formatDate(row.expiresAt)}` : `Expires ${formatDate(row.expiresAt)}`}</td>
              <td {...cardCell("Email")}>{emailDeliveryLabel[row.delivery]}</td>
              <td {...cardCell(null)}>
                {row.submissionId && <Link className="secondary-button" href={`${base}/submissions/${row.submissionId}`}>View slip<span className="sr-only"> for {row.name}</span></Link>}
                {open && row.state !== "SIGNED" && <ResendOutingButton memberId={row.memberId} name={row.name} organizationId={organizationId} outingId={outingId} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
