"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { STAFF_INVITATION_GROUPS, STAFF_INVITATION_GROUP_LABEL, type StaffInvitationGroupValue } from "@/modules/staff-invitations/domain";
import { useTableSort, type ColumnSpec } from "@/components/use-table-sort";
import type { ApprovalRow } from "@/modules/staff-invitations/repository";

type Props = {
  eventId: string;
  rows: ApprovalRow[];
  counts: { WAITING: number; APPROVED: number; DECLINED: number };
};

const BATCH_MAX = 200;

type Filter = "WAITING" | "APPROVED" | "DECLINED" | "ALL";

const roleLabel: Record<string, string> = { PRIMARY: "Invited person", SPOUSE: "Spouse", DEPENDANT: "Child or dependant" };

// Sorts from its headers (#1458); the keys here are the whitelist. Only what a column already shows is sortable.
const APPROVAL_SORT: Record<"registration" | "group" | "party" | "housing" | "state", ColumnSpec<ApprovalRow>> = {
  registration: { get: (row) => row.name || row.email, label: "registration" },
  group: { get: (row) => STAFF_INVITATION_GROUP_LABEL[row.group], label: "group" },
  party: { get: (row) => row.party.length, label: "party size", kind: "number" },
  housing: { get: (row) => (row.needsHousing === null ? null : row.needsHousing), label: "housing request" },
  state: { get: (row) => row.approval, label: "state" },
};

/**
 * The approval queue (#804): registrations made through personal links, waiting for the office. They are approved or declined
 * in one batch, normally when housing is assigned, with select-all. Approving confirms the registration (its confirmation is
 * queued in the outbox) and covers its meals; declining cancels it. Nothing is decided until the button is pressed.
 */
export function StaffApprovalQueue({ eventId, rows, counts }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("WAITING");
  const [group, setGroup] = useState<StaffInvitationGroupValue | "ALL">("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<"APPROVE" | "DECLINE" | "RETRY_MEALS" | null>(null);
  const [withoutMeals, setWithoutMeals] = useState(false);
  const [needsMealChoice, setNeedsMealChoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const visible = useMemo(() => rows.filter((row) => (filter === "ALL" || row.approval === filter) && (group === "ALL" || row.group === group)), [rows, filter, group]);
  const sorted = useTableSort(visible, APPROVAL_SORT);
  const waitingVisible = visible.filter((row) => row.approval === "WAITING");
  const selectedRows = [...selected].flatMap((id) => rows.find((row) => row.id === id) ?? []);
  const selectedIds = selectedRows.filter((row) => row.approval === "WAITING").map((row) => row.id);
  const approvedWithoutMeals = rows.filter((row) => row.approval === "APPROVED" && row.peopleWithoutMeals > 0);
  const retryIds = selectedRows.filter((row) => row.approval === "APPROVED" && row.peopleWithoutMeals > 0).map((row) => row.id);
  const overCap = (pending === "RETRY_MEALS" ? retryIds : selectedIds).length > BATCH_MAX;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function decide(decision: "APPROVE" | "DECLINE" | "RETRY_MEALS") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/staff-invitations/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          ids: decision === "RETRY_MEALS" ? retryIds : selectedIds,
          ...(decision === "APPROVE" ? { withoutMealCoverage: withoutMeals } : {}),
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        message?: string;
        error?: string;
        result?: { decided: number; skipped: number; failed: number; meals?: { planFound: boolean; entitledPeople: number; failedPeople: number; failed: Array<{ name: string }> } };
      };
      if (!response.ok || !body.result) {
        if (body.error === "MEAL_PLAN_REQUIRED") setNeedsMealChoice(true);
        throw new Error(body.message ?? "That couldn't be done. Refresh to see what changed.");
      }
      const { decided, skipped, failed, meals } = body.result;
      const parts = [`${decided} ${decision === "APPROVE" ? "approved" : decision === "DECLINE" ? "declined" : "checked for meal coverage"}`];
      if (skipped > 0) parts.push(`${skipped} skipped (no longer waiting)`);
      if (failed > 0) parts.push(`${failed} could not be changed, try them again`);
      if (decision !== "DECLINE" && meals) {
        parts.push(meals.planFound
          ? `${meals.entitledPeople} ${meals.entitledPeople === 1 ? "person" : "people"} given the conference-paid meal plan`
          : "this event has no single conference-paid meal plan, so no meals were covered");
        if (meals.failedPeople > 0) {
          const names = meals.failed.map((person) => person.name || "someone").slice(0, 12).join(", ");
          parts.push(`${meals.failedPeople} without meal coverage (${names}${meals.failed.length > 12 ? ", and more" : ""}); use Retry meal coverage once the plan is fixed`);
        }
      }
      setNotice(`${parts.join("; ")}.`);
      setNeedsMealChoice(false);
      setWithoutMeals(false);
      setSelected(new Set());
      setPending(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request failed. Some registrations may have been changed; refresh to see the current state.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="staff-invite-filters">
        <label>
          Show
          <select onChange={(changeEvent) => setFilter(changeEvent.target.value as Filter)} value={filter}>
            <option value="WAITING">Waiting for approval ({counts.WAITING})</option>
            <option value="APPROVED">Approved ({counts.APPROVED})</option>
            <option value="DECLINED">Declined ({counts.DECLINED})</option>
            <option value="ALL">Everything</option>
          </select>
        </label>
        <label>
          Group
          <select onChange={(changeEvent) => setGroup(changeEvent.target.value as StaffInvitationGroupValue | "ALL")} value={group}>
            <option value="ALL">All groups</option>
            {STAFF_INVITATION_GROUPS.map((entry) => <option key={entry} value={entry}>{STAFF_INVITATION_GROUP_LABEL[entry]}</option>)}
          </select>
        </label>
      </div>

      {approvedWithoutMeals.length > 0 && (
        <p className="inline-notice error" role="note">
          {approvedWithoutMeals.reduce((total, row) => total + row.peopleWithoutMeals, 0)} approved {approvedWithoutMeals.length === 1 ? "person has" : "people have"} no conference-paid meals yet. Tick those registrations and use Retry meal coverage.
        </p>
      )}
      <div className="panel selection-bar">
        <span role="status">{selectedRows.length > 0 ? <><strong>{selectedRows.length}</strong> selected</> : "Tick registrations, or use Select all."}</span>
        <div className="selection-bar-actions">
          {waitingVisible.length > 0 && selectedIds.length < waitingVisible.length && (
            <button className="text-button" onClick={() => setSelected(new Set(waitingVisible.map((row) => row.id)))} type="button">Select all {waitingVisible.length} waiting</button>
          )}
          {selectedRows.length > 0 && (
            <>
              <button className="text-button" onClick={() => { setSelected(new Set()); setPending(null); }} type="button">Clear selection</button>
              <button className="primary-button" disabled={busy || selectedIds.length === 0} onClick={() => setPending("APPROVE")} type="button"><CheckCircle2 aria-hidden="true" size={16} /> Approve…</button>
              <button className="secondary-button outline-action" disabled={busy || selectedIds.length === 0} onClick={() => setPending("DECLINE")} type="button"><XCircle aria-hidden="true" size={16} /> Decline…</button>
              {retryIds.length > 0 && <button className="secondary-button outline-action" disabled={busy} onClick={() => setPending("RETRY_MEALS")} type="button">Retry meal coverage…</button>}
            </>
          )}
        </div>
      </div>

      {pending && (
        <div className="staff-invite-preview" role="alertdialog" aria-label={pending === "APPROVE" ? "Confirm approval" : "Confirm decline"}>
          {overCap && <p className="inline-notice error" role="alert">At most {BATCH_MAX} registrations can be decided at a time. Clear some from the selection and do the rest in another batch.</p>}
          {pending === "APPROVE" && needsMealChoice && (
            <label className="checkbox-label">
              <input checked={withoutMeals} onChange={(changeEvent) => setWithoutMeals(changeEvent.target.checked)} type="checkbox" />
              Approve without meal coverage. This event has no single conference-paid meal plan, so these people will have no meals until it is fixed.
            </label>
          )}
          <p>
            {pending === "RETRY_MEALS" ? `Give the ${retryIds.length} selected approved registration${retryIds.length === 1 ? "" : "s"} the conference-paid meal plan again? Nobody is charged.` : pending === "APPROVE"
              ? `Approve ${selectedIds.length} registration${selectedIds.length === 1 ? "" : "s"}? Each becomes a confirmed registration at no charge, its confirmation email is queued in the outbox, and every person in it is given the conference-paid meal plan.`
              : `Decline ${selectedIds.length} registration${selectedIds.length === 1 ? "" : "s"}? Each is cancelled and its link cannot be used again. Its registrant is sent the usual cancellation notice.`}
          </p>
          <div className="intro-actions">
            <button className="primary-button" disabled={busy || overCap || (pending === "APPROVE" && needsMealChoice && !withoutMeals)} onClick={() => void decide(pending)} type="button">{busy ? "Working…" : pending === "APPROVE" ? `Approve ${selectedIds.length}` : pending === "DECLINE" ? `Decline ${selectedIds.length}` : `Retry for ${retryIds.length}`}</button>
            <button className="text-button" onClick={() => setPending(null)} type="button">Cancel</button>
          </div>
        </div>
      )}
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}

      {visible.length === 0 ? (
        <section className="panel empty-state"><h3>Nothing here</h3><p>No registrations match. People appear here after they register through their personal link.</p></section>
      ) : (
        <div className="report-table-wrap card-box">
          {sorted.note}
          <table className="report-table staff-invite-table">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Select</span></th>
                {sorted.header("registration", "Registration")}
                {sorted.header("group", "Group")}
                {sorted.header("party", "Party")}
                {sorted.header("housing", "Housing request")}
                {sorted.header("state", "State")}
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {(row.approval === "WAITING" || (row.approval === "APPROVED" && row.peopleWithoutMeals > 0)) && <label className="staff-invite-select"><input aria-label={`Select ${row.confirmationCode}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} type="checkbox" /></label>}
                  </td>
                  <td data-label="Registration">
                    <strong>{row.name || row.email}</strong>
                    <br /><span className="field-help">{row.confirmationCode} · {row.email}</span>
                    <br /><span className="field-help">Registered {row.registeredAt.slice(0, 16).replace("T", " ")} UTC</span>
                  </td>
                  <td data-label="Group">{STAFF_INVITATION_GROUP_LABEL[row.group]}</td>
                  <td data-label="Party">
                    <ul className="staff-invite-party">
                      {row.party.map((person, index) => (
                        <li key={`${row.id}-${index}`}>{person.name} <span className="field-help">({roleLabel[person.role] ?? person.role}{person.age !== null ? `, age ${person.age}` : ""})</span></li>
                      ))}
                    </ul>
                  </td>
                  <td data-label="Housing request">
                    {row.needsHousing === null ? "—" : row.needsHousing ? "Needs on-site housing" : "No housing needed"}
                    {row.housingNote && <><br /><span className="field-help">{row.housingNote}</span></>}
                  </td>
                  <td data-label="State">
                    <span className={`status-chip ${row.approval === "APPROVED" ? "green" : row.approval === "DECLINED" ? "coral" : "gold"}`}>{row.approval === "WAITING" ? "Waiting for approval" : row.approval === "APPROVED" ? "Approved" : "Declined"}</span>
                    {row.peopleWithoutMeals > 0 && <><br /><span className="field-help">{row.peopleWithoutMeals} without meal coverage</span></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
