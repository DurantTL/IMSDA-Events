"use client";

import { ExportLink } from "@/components/export-link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cardCell } from "@/components/table-card-labels";
import { useTableSort, type ColumnSpec } from "@/components/use-table-sort";
import { assigneeKindLabels } from "@/modules/issued-assets/domain";
import type { ChargeRow, CloseoutReport, CloseoutRow, DepositRow, ExceptionRow, TypeReconciliation } from "@/modules/issued-assets/closeout";
import { formatCentsPlain } from "@/modules/payments/format-cents";
import { chargeCategoryLabels, facilitySeverities, facilityStatuses, holdKindLabels } from "@/modules/issued-assets/returns-domain";
import type { FacilityIssueRow } from "@/modules/issued-assets/returns-view";
import { lodgingHoldKinds } from "@/modules/lodging/domain";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { savedMessage } from "@/components/form-message";

/**
 * The issued-asset closeout (#214): what is still out, lost, damaged, charged, waived and held, the facility issues that
 * are still open, and every exception that needs a person, with a CSV for each list. Reading is for check-in staff,
 * finance, event administrators and report viewers; a waiver needs finance or an event administrator and a reason. Nothing
 * here charges, waives or settles by itself. Tables become stacked cards on a phone (docs/RESPONSIVE.md).
 */

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(16).slice(2)}`);
const when = (iso: string | null) => (iso ? formatInConferenceTime(iso, { dateStyle: "medium", timeStyle: "short" }) : "");


export function AssetCloseoutWorkspace({ eventId, eventName, report, staff, canManageMoney, canConfigure, canUpdateFacility }: {
  eventId: string;
  eventName: string;
  report: CloseoutReport;
  staff: Array<{ userId: string; name: string }>;
  canManageMoney: boolean;
  canConfigure: boolean;
  canUpdateFacility: boolean;
}) {
  const router = useRouter();
  const base = `/api/events/${encodeURIComponent(eventId)}/assets`;
  const csv = (section: string) => `${base}/closeout?format=csv&section=${section}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // One saved key per intended action, kept until the server confirms it: a retry after a lost response replays.
  const actionKeys = useRef<Record<string, string>>({});
  async function post(path: string, body: unknown, done: string) {
    setBusy(true); setError(""); setNotice("");
    const signature = `${path}:${JSON.stringify(body)}`;
    try {
      const keyed = path === "facility" ? body : { ...(body as object), idempotencyKey: (actionKeys.current[signature] ??= newKey()) };
      const response = await fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(keyed) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message ?? "That could not be saved.");
      delete actionKeys.current[signature];
      setNotice(done);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That could not be saved."); }
    finally { setBusy(false); }
  }

  const deskHref = (attendeeId: string | null) => (attendeeId ? `/check-in/assets?event=${encodeURIComponent(eventId)}&attendee=${encodeURIComponent(attendeeId)}` : null);
  const holder = (row: { holderLabel: string; deskAttendeeId: string | null }) => { const href = deskHref(row.deskAttendeeId); return href ? <a href={href}>{row.holderLabel}</a> : <>{row.holderLabel}</>; };
  const download = (section: string) => <p><ExportLink className="secondary-button report-download" href={csv(section)}>Download CSV</ExportLink></p>;
  const ctx: TableContext = { holder, download, canManageMoney, busy, post };
  return <div className="settings-stack">
    <div className="page-intro"><div>
      <p className="eyebrow">Event configuration</p>
      <h2 className="duplicate-page-title">Issued asset closeout</h2>
      <p>{eventName}: keys and items still out, lost, damaged, charged, waived or held as cash deposits, and facility problems still open. This page reads only; it does not charge, waive, refund or release anything by itself. Generated {when(report.generatedAt)}.</p>
    </div></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="usage-note" role="status">{notice}</p> : null}
    {report.truncated ? <p role="status">A list was cut short at its limit. Download the CSV and narrow the event before closing out.</p> : null}

    <section className="panel form-stack">
      <h3>{report.unresolvedCount === 0 ? "Nothing is unresolved" : `${report.unresolvedCount} unresolved`}</h3>
      {download("exceptions")}
      {report.exceptions.length === 0 ? <p>Every key and item is accounted for, every deposit is settled and no facility issue is open.</p> : <ExceptionsTable ctx={ctx} rows={report.exceptions} />}
    </section>

    <section className="panel form-stack">
      <h3>Issued, returned and outstanding</h3>
      {download("summary")}
      <TypesTable rows={report.types} />
      <p>Cash deposits: {formatCentsPlain(report.money.depositsReceivedCents)} received, {formatCentsPlain(report.money.depositsHandedBackCents)} handed back, {formatCentsPlain(report.money.depositsKeptCents)} kept, {formatCentsPlain(report.money.depositsHeldCents)} still held. Charges: {formatCentsPlain(report.money.chargedCents)}, waived {formatCentsPlain(report.money.waivedCents)}, net {formatCentsPlain(report.money.netChargedCents)}.</p>
    </section>

    <IssueTable ctx={ctx} empty="Nothing is out." rows={report.outstanding} section="outstanding" title="Still out" />
    <IssueTable ctx={ctx} empty="Nothing was recorded lost." rows={report.lost} section="lost" title="Lost" />
    <IssueTable ctx={ctx} empty="Nothing came back damaged." rows={report.damaged} section="damaged" title="Returned damaged" />

    <section className="panel form-stack">
      <h3>Charges and waivers ({report.charges.length})</h3>
      {download("charges")}
      {report.charges.length === 0 ? <p>No charge has been recorded.</p> : <ChargesTable ctx={ctx} rows={report.charges} />}
      {canManageMoney ? null : <p>Waiving a charge needs finance or an event administrator.</p>}
    </section>

    <section className="panel form-stack">
      <h3>Cash key deposits ({report.deposits.length})</h3>
      {download("deposits")}
      {report.deposits.length === 0 ? <p>No deposit has been recorded.</p> : <DepositsTable ctx={ctx} rows={report.deposits} />}
    </section>

    <section className="panel form-stack">
      <h3>Facility issues still open ({report.facility.length})</h3>
      {download("facility")}
      {report.facility.length === 0 ? <p>No facility issue is open.</p> : report.facility.map((issue) => <FacilityCard key={issue.id} issue={issue} staff={staff} canUpdate={canUpdateFacility} canConfigure={canConfigure} busy={busy} post={post} />)}
    </section>
  </div>;
}

/** What the closeout's tables share: the holder link, the CSV link, the money permission and the save call. */
type TableContext = {
  holder: (row: { holderLabel: string; deskAttendeeId: string | null }) => React.ReactNode;
  download: (section: string) => React.ReactNode;
  canManageMoney: boolean;
  busy: boolean;
  post: (path: string, body: unknown, done: string) => Promise<void>;
};

// Every table here sorts from its headers (#1458). Each has its own address prefix, and the keys on these objects are the whitelist.
const ISSUE_SORT: Record<"item" | "qty" | "holder" | "room" | "issued" | "ended", ColumnSpec<CloseoutRow>> = {
  item: { value: (row) => row.identifier, label: "item" },
  qty: { value: (row) => row.quantity, label: "quantity", kind: "number" },
  holder: { value: (row) => row.holderLabel, label: "holder" },
  room: { value: (row) => row.roomName, label: "room" },
  issued: { value: (row) => row.issuedAt, label: "issue date", kind: "date" },
  ended: { value: (row) => row.endedAt ?? row.expectedReturnAt, label: "date", kind: "date" },
};
const EXCEPTION_SORT: Record<"exception" | "item" | "holder" | "detail", ColumnSpec<ExceptionRow>> = {
  exception: { value: (row) => row.label, label: "exception" },
  item: { value: (row) => row.subject, label: "item" },
  holder: { value: (row) => row.holderLabel, label: "holder" },
  detail: { value: (row) => row.detail, label: "detail" },
};
const TYPE_SORT: Record<"kind" | "out" | "returned" | "lost" | "damaged" | "corrected" | "replaced" | "stillOut" | "reconciles", ColumnSpec<TypeReconciliation>> = {
  kind: { value: (row) => row.typeName, label: "kind" },
  out: { value: (row) => row.inflow, label: "went out", kind: "number" },
  returned: { value: (row) => row.returned, label: "returned", kind: "number" },
  lost: { value: (row) => row.lost, label: "lost", kind: "number" },
  damaged: { value: (row) => row.damaged, label: "damaged", kind: "number" },
  corrected: { value: (row) => row.corrected, label: "withdrawn in error", kind: "number" },
  replaced: { value: (row) => row.replacedUnaccounted, label: "replaced, unaccounted", kind: "number" },
  stillOut: { value: (row) => row.outstanding, label: "still out", kind: "number" },
  reconciles: { value: (row) => row.balanced, label: "whether it reconciles" },
};
const CHARGE_SORT: Record<"item" | "holder" | "charge" | "state" | "why", ColumnSpec<ChargeRow>> = {
  item: { value: (row) => row.identifier, label: "item" },
  holder: { value: (row) => row.holderLabel, label: "holder" },
  charge: { value: (row) => row.amountCents, label: "charge amount", kind: "number" },
  state: { value: (row) => row.state, label: "state" },
  why: { value: (row) => row.at, label: "date recorded", kind: "date" },
};
const DEPOSIT_SORT: Record<"holder" | "kind" | "deposit" | "state" | "items", ColumnSpec<DepositRow>> = {
  holder: { value: (row) => row.holderLabel, label: "holder" },
  kind: { value: (row) => row.typeName, label: "kind" },
  deposit: { value: (row) => row.amountCents, label: "deposit amount", kind: "number" },
  state: { value: (row) => row.state, label: "state" },
  items: { value: (row) => row.covered, label: "items covered", kind: "number" },
};

function IssueTable({ ctx, title, rows, section, empty }: { ctx: TableContext; title: string; rows: CloseoutRow[]; section: "outstanding" | "lost" | "damaged"; empty: string }) {
  const { holder, download, canManageMoney, busy, post } = ctx;
  const sorted = useTableSort(rows, ISSUE_SORT, section);
  return <section className="panel form-stack">
    <h3>{title} ({rows.length})</h3>
    {download(section)}
    {rows.length === 0 ? <p>{empty}</p> : <div className="table-wrap card-box">{sorted.note}<table role="table" className="report-table table-cards table-cards-compact">
      <caption className="sr-only">{title}</caption>
      <thead role="rowgroup"><tr role="row">{sorted.header("item", "Item")}{sorted.header("qty", "Qty")}{sorted.header("holder", "Holder")}{sorted.header("room", "Room")}{sorted.header("issued", "Issued")}{sorted.header("ended", section === "outstanding" ? "Expected back" : "Ended")}{canManageMoney && section !== "outstanding" ? <th role="columnheader" scope="col">Correct</th> : null}</tr></thead>
      <tbody role="rowgroup">{sorted.rows.map((row) => <tr role="row" key={row.id}>
        <th role="rowheader" scope="row">{row.identifier} <small>{row.typeName}</small></th><td {...cardCell("Qty")}>{row.quantity}</td>
        <td {...cardCell("Holder")}>{holder({ holderLabel: row.holderLabel, deskAttendeeId: row.deskAttendeeId })} <small>({assigneeKindLabels[row.holderKind].toLowerCase()})</small></td>
        <td {...cardCell("Room")}>{row.roomName ?? ""}</td><td {...cardCell("Issued")}>{when(row.issuedAt)}</td>
        <td {...cardCell(section === "outstanding" ? "Expected back" : "Ended")}>{section === "outstanding" ? (row.expectedReturnAt ? `${when(row.expectedReturnAt)}${row.overdue ? " (past due)" : ""}` : "") : `${when(row.endedAt)}${row.endNote ? `: ${row.endNote}` : ""}`}</td>
        {canManageMoney && section !== "outstanding" ? <td {...cardCell(null)}><OutcomeForm busy={busy} current={section === "lost" ? "LOST" : "DAMAGED"} onSubmit={(body) => post("corrections", { ...body, issuanceId: row.id }, "Saved. Nothing was refunded or charged; review the closeout.")} /></td> : null}
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

function ExceptionsTable({ ctx, rows }: { ctx: TableContext; rows: ExceptionRow[] }) {
  const { holder, canManageMoney, busy, post } = ctx;
  const sorted = useTableSort(rows, EXCEPTION_SORT, "exceptions");
  return <div className="table-wrap card-box">{sorted.note}<table role="table" className="report-table table-cards table-cards-compact">
    <caption className="sr-only">Unresolved items</caption>
    <thead role="rowgroup"><tr role="row">{sorted.header("exception", "Exception")}{sorted.header("item", "Item")}{sorted.header("holder", "Holder")}{sorted.header("detail", "Detail")}{canManageMoney ? <th role="columnheader" scope="col">Resolve</th> : null}</tr></thead>
    <tbody role="rowgroup">{sorted.rows.map((row) => <tr role="row" key={`${row.code}:${row.refId}:${row.triggerId ?? ""}`}>
      <th role="rowheader" scope="row">{row.label}</th><td {...cardCell("Item")}>{row.subject}</td><td {...cardCell("Holder")}>{row.holderLabel ? holder({ holderLabel: row.holderLabel, deskAttendeeId: row.deskAttendeeId }) : ""}</td><td {...cardCell("Detail")}>{row.detail}</td>
      {canManageMoney ? <td {...cardCell(null)}>{row.code === "UNCHARGED_LOSS" || row.code === "REPLACED_UNACCOUNTED" ? <OutcomeForm busy={busy} current={row.code === "REPLACED_UNACCOUNTED" ? "REPLACED" : "LOST"} onSubmit={(body) => post("corrections", { ...body, issuanceId: row.refId }, "Saved. Nothing was refunded or charged.")} />
        : row.code === "CORRECTION_NEEDS_REVIEW" || row.code === "CHARGED_ON_CANCELLED_REGISTRATION" || row.code === "WAIVED_ON_INACTIVE_REGISTRATION" || row.code === "WAIVED_AFTER_REFUND"
          ? <ReviewForm busy={busy} depositId={row.code === "CORRECTION_NEEDS_REVIEW" ? row.depositId ?? null : null}
              onReview={(reason) => post("corrections", { action: "review", issuanceId: row.refId, exceptionCode: row.code, ...(row.triggerId ? { triggerId: row.triggerId } : {}), reason }, "Marked as reviewed. Nothing was refunded or charged.")}
              onRefund={(depositEntryId, amountCents, reason) => post("corrections", { action: "refund_after_correction", depositEntryId, amountCents, reason }, `Recorded ${formatCentsPlain(amountCents)} of the kept deposit handed back at the desk.`)} />
          : null}</td> : null}
    </tr>)}</tbody>
  </table></div>;
}

function TypesTable({ rows }: { rows: TypeReconciliation[] }) {
  const sorted = useTableSort(rows, TYPE_SORT, "kinds");
  return <div className="table-wrap card-box">{sorted.note}<table role="table" className="report-table table-cards table-cards-tablet">
    <caption className="sr-only">Units issued, returned, lost, damaged and still out, by kind</caption>
    <thead role="rowgroup"><tr role="row">{sorted.header("kind", "Kind")}{sorted.header("out", "Went out")}{sorted.header("returned", "Returned")}{sorted.header("lost", "Lost")}{sorted.header("damaged", "Damaged")}{sorted.header("corrected", "Withdrawn in error")}{sorted.header("replaced", "Replaced, unaccounted")}{sorted.header("stillOut", "Still out")}{sorted.header("reconciles", "Reconciles")}</tr></thead>
    <tbody role="rowgroup">{sorted.rows.map((row) => <tr role="row" key={row.typeId}>
      <th role="rowheader" scope="row">{row.typeName}</th><td {...cardCell("Went out")}>{row.inflow}</td><td {...cardCell("Returned")}>{row.returned}</td><td {...cardCell("Lost")}>{row.lost}</td><td {...cardCell("Damaged")}>{row.damaged}</td>
      <td {...cardCell("Withdrawn in error")}>{row.corrected}</td><td {...cardCell("Replaced, unaccounted")}>{row.replacedUnaccounted}</td><td {...cardCell("Still out")}>{row.outstanding}</td>
      <td {...cardCell("Reconciles")}>{row.balanced ? "Yes" : `No, off by ${row.difference}`}</td>
    </tr>)}</tbody>
  </table></div>;
}

function ChargesTable({ ctx, rows }: { ctx: TableContext; rows: ChargeRow[] }) {
  const { holder, canManageMoney, busy, post } = ctx;
  const sorted = useTableSort(rows, CHARGE_SORT, "charges");
  return <div className="table-wrap card-box">{sorted.note}<table role="table" className="report-table table-cards table-cards-compact">
    <caption className="sr-only">Charges and waivers</caption>
    <thead role="rowgroup"><tr role="row">{sorted.header("item", "Item")}{sorted.header("holder", "Holder")}{sorted.header("charge", "Charge")}{sorted.header("state", "State")}{sorted.header("why", "Why")}{canManageMoney ? <th role="columnheader" scope="col">Waive</th> : null}</tr></thead>
    <tbody role="rowgroup">{sorted.rows.map((row) => <tr role="row" key={row.entryId}>
      <th role="rowheader" scope="row">{row.identifier} <small>{row.typeName}</small></th>
      <td {...cardCell("Holder")}>{holder(row)}</td>
      <td {...cardCell("Charge")}>{chargeCategoryLabels[row.category]} {formatCentsPlain(row.amountCents)}{row.posted ? " (on the registration)" : " (recorded only)"}</td>
      <td {...cardCell("State")}>{row.state === "WAIVED" ? `Waived by ${row.waiver!.actorName}: ${row.waiver!.reason}` : "Charged"}</td>
      <td {...cardCell("Why")}>{row.reason} <small>({row.actorName}, {when(row.at)})</small></td>
      {canManageMoney ? <td {...cardCell(null)}>{row.state === "CHARGED" ? <WaiveForm busy={busy} onWaive={(reason) => post("charges", { action: "waive", chargeEntryId: row.entryId, reason }, `Waived ${formatCentsPlain(row.amountCents)} for ${row.identifier}.`)} /> : null}</td> : null}
    </tr>)}</tbody>
  </table></div>;
}

function DepositsTable({ ctx, rows }: { ctx: TableContext; rows: DepositRow[] }) {
  const { holder } = ctx;
  const sorted = useTableSort(rows, DEPOSIT_SORT, "deposits");
  return <div className="table-wrap card-box">{sorted.note}<table role="table" className="report-table table-cards table-cards-compact">
    <caption className="sr-only">Cash key deposits</caption>
    <thead role="rowgroup"><tr role="row">{sorted.header("holder", "Holder")}{sorted.header("kind", "Kind")}{sorted.header("deposit", "Deposit")}{sorted.header("state", "State")}{sorted.header("items", "Items")}</tr></thead>
    <tbody role="rowgroup">{sorted.rows.map((row) => <tr role="row" key={row.entryId}>
      <th role="rowheader" scope="row">{holder(row)}</th><td {...cardCell("Kind")}>{row.typeName}</td><td {...cardCell("Deposit")}>{formatCentsPlain(row.amountCents)}</td>
      <td {...cardCell("State")}>{row.state === "HELD" ? (row.readyToSettle ? "Held, ready to settle at the desk" : "Held") : row.state === "HANDED_BACK" ? "Handed back in full" : row.state === "KEPT" ? "Kept" : row.state === "PARTLY_HANDED_BACK" ? `Partly handed back: ${formatCentsPlain(row.refundCents)} handed back (${formatCentsPlain(row.lateHandedBackCents)} of it after a found item), ${formatCentsPlain(row.keepCents)} kept, ${formatCentsPlain(row.stillHeldCents)} of that still held` : `${formatCentsPlain(row.refundCents)} handed back, ${formatCentsPlain(row.keepCents)} kept`}</td>
      <td {...cardCell("Items")}>{row.covered} covered{row.stillOut > 0 ? `, ${row.stillOut} still out` : ""}</td>
    </tr>)}</tbody>
  </table></div>;
}

/**
 * Records what really happened to an item, or writes a loss off (finance and administrators, with a reason). A lost key
 * found later is Lost corrected to Returned. Nothing is refunded, charged or settled by it; the closeout lists anything
 * that needs a decision afterwards.
 */
function OutcomeForm({ busy, current, onSubmit }: { busy: boolean; current: "LOST" | "DAMAGED" | "REPLACED"; onSubmit: (body: { action: "correct"; fate: string; reason: string } | { action: "write_off"; reason: string }) => Promise<void> }) {
  const [choice, setChoice] = useState(current === "REPLACED" ? "RETURNED" : "WRITE_OFF");
  const [reason, setReason] = useState("");
  return <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (reason.trim().length >= 3) void onSubmit(choice === "WRITE_OFF" ? { action: "write_off", reason: reason.trim() } : { action: "correct", fate: choice, reason: reason.trim() }); }}>
    <label>What happened <select value={choice} onChange={(event) => setChoice(event.target.value)}>
      <option value="RETURNED">{current === "LOST" ? "Found: it came back" : "It came back"}</option>
      <option value="LOST">Lost</option>
      <option value="DAMAGED">Returned damaged</option>
      <option value="WRITE_OFF">Write off, charge nothing</option>
    </select></label>
    <label>Reason <input value={reason} minLength={3} maxLength={500} required onChange={(event) => setReason(event.target.value)} /></label>
    <button className="secondary-button" type="submit" disabled={busy}>Save</button>
  </form>;
}

/**
 * An exception that needs a person's eyes: mark it reviewed with a reason, or (for a kept deposit whose key was found) record
 * the cash handed back at the desk. Finance and administrators only. Recording cash is a record, never a provider refund.
 */
function ReviewForm({ busy, depositId, onReview, onRefund }: { busy: boolean; depositId: string | null; onReview: (reason: string) => Promise<void>; onRefund: (depositEntryId: string, amountCents: number, reason: string) => Promise<void> }) {
  const [choice, setChoice] = useState("REVIEWED");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  return <form className="form-stack" onSubmit={(event) => {
    event.preventDefault();
    if (reason.trim().length < 3) return;
    if (choice === "REFUND" && depositId) { const cents = Math.round(Number(amount) * 100); if (cents >= 1) void onRefund(depositId, cents, reason.trim()); } else void onReview(reason.trim());
  }}>
    <label>What was done <select value={choice} onChange={(event) => setChoice(event.target.value)}>
      <option value="REVIEWED">Reviewed, nothing more to do</option>
      {depositId ? <option value="REFUND">Cash handed back from the kept deposit</option> : null}
    </select></label>
    {choice === "REFUND" && depositId ? <label>Amount handed back (dollars) <input type="number" min="0.01" step="0.01" style={{ width: "100%" }} value={amount} onChange={(event) => setAmount(event.target.value)} required /></label> : null}
    <label>Reason <input value={reason} minLength={3} maxLength={500} required onChange={(event) => setReason(event.target.value)} /></label>
    <button className="secondary-button" type="submit" disabled={busy}>Save</button>
  </form>;
}

function WaiveForm({ busy, onWaive }: { busy: boolean; onWaive: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  return <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (reason.trim().length >= 3) void onWaive(reason.trim()); }}>
    <label>Reason to waive <input value={reason} minLength={3} maxLength={500} required onChange={(event) => setReason(event.target.value)} /></label>
    <button className="secondary-button" type="submit" disabled={busy}>Waive</button>
  </form>;
}

function FacilityCard({ issue, staff, canUpdate, canConfigure, busy, post }: {
  issue: FacilityIssueRow; staff: Array<{ userId: string; name: string }>; canUpdate: boolean; canConfigure: boolean; busy: boolean;
  post: (path: string, body: unknown, done: string) => Promise<void>;
}) {
  const [status, setStatus] = useState(issue.status);
  const [severity, setSeverity] = useState(issue.severity);
  const [assignee, setAssignee] = useState(issue.assigneeUserId ?? "");
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [kind, setKind] = useState<(typeof lodgingHoldKinds)[number]>("MAINTENANCE");
  const [firstNight, setFirstNight] = useState("");
  const [lastNight, setLastNight] = useState("");
  const finishing = status === "RESOLVED" || status === "DISMISSED";
  const blocked = issue.block?.active ?? false;
  return <article className="panel form-stack">
    <h4>{issue.targetLabel}: {issue.title}</h4>
    <p>{issue.severity.toLowerCase()} severity, {issue.status === "OPEN" ? "open" : "in progress"}; reported {when(issue.reportedAt)}{issue.reportedByName ? ` by ${issue.reportedByName}` : ""}{issue.source === "CHECKOUT_INSPECTION" ? " at check-out" : ""}. {issue.assigneeName ? `Assigned to ${issue.assigneeName}.` : "Not assigned."}{issue.description ? ` ${issue.description}` : ""}</p>
    {issue.block ? <p role="status">{issue.block.active ? `Blocked (${holdKindLabels[issue.block.kind as keyof typeof holdKindLabels] ?? issue.block.kind}) ${issue.block.firstNight} to ${issue.block.lastNight}. People already placed were not moved.` : "Its block was released."}</p> : null}
    <details><summary>History ({issue.history.length})</summary><ul>{issue.history.map((entry, index) => <li key={index}>{when(entry.at)}: {entry.type.toLowerCase().replace("_", " ")}{entry.actorName ? ` by ${entry.actorName}` : ""}, {entry.status.toLowerCase().replace("_", " ")}, {entry.severity.toLowerCase()}{entry.note ? `: ${entry.note}` : ""}</li>)}</ul></details>
    {canUpdate ? <form className="form-stack" onSubmit={(event) => {
      event.preventDefault();
      void post("facility", {
        action: "update", issueId: issue.id, ...(status !== issue.status ? { status } : {}), ...(severity !== issue.severity ? { severity } : {}),
        ...(assignee !== (issue.assigneeUserId ?? "") ? { assigneeUserId: assignee } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(finishing ? { resolution: resolution.trim() } : {}),
      }, savedMessage());
    }}>
      <label>Status <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{facilityStatuses.map((value) => <option key={value} value={value}>{value.toLowerCase().replace("_", " ")}</option>)}</select></label>
      <label>Severity <select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>{facilitySeverities.map((value) => <option key={value} value={value}>{value.toLowerCase()}</option>)}</select></label>
      <label>Assigned to <select value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="">Nobody</option>{staff.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label>
      <label>Note <input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>
      {finishing ? <label>How it was resolved <input value={resolution} maxLength={500} required onChange={(event) => setResolution(event.target.value)} /></label> : null}
      <button className="secondary-button" type="submit" disabled={busy}>Save</button>
    </form> : null}
    {canConfigure && issue.targetKind === "UNIT" && !blocked ? <form className="form-stack" onSubmit={(event) => {
      event.preventDefault();
      void post("facility", { action: "block", issueId: issue.id, block: { kind, reason: issue.title, firstNight, lastNight } }, "The room is blocked for those nights. Nobody already placed was moved.");
    }}>
      <label>Block the room <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>{lodgingHoldKinds.map((value) => <option key={value} value={value}>{holdKindLabels[value]}</option>)}</select></label>
      <label>First night <input type="date" value={firstNight} required onChange={(event) => setFirstNight(event.target.value)} /></label>
      <label>Last night <input type="date" value={lastNight} required onChange={(event) => setLastNight(event.target.value)} /></label>
      <button className="secondary-button" type="submit" disabled={busy}>Block the room</button>
    </form> : null}
  </article>;
}
