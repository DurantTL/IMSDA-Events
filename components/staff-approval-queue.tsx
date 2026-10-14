"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { STAFF_INVITATION_GROUPS, STAFF_INVITATION_GROUP_LABEL, type StaffInvitationGroupValue } from "@/modules/staff-invitations/domain";
import type { ApprovalRow } from "@/modules/staff-invitations/repository";

type Props = {
  eventId: string;
  rows: ApprovalRow[];
  counts: { WAITING: number; APPROVED: number; DECLINED: number };
};

type Filter = "WAITING" | "APPROVED" | "DECLINED" | "ALL";

const roleLabel: Record<string, string> = { PRIMARY: "Invited person", SPOUSE: "Spouse", DEPENDANT: "Child or dependant" };

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
  const [pending, setPending] = useState<"APPROVE" | "DECLINE" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const visible = useMemo(() => rows.filter((row) => (filter === "ALL" || row.approval === filter) && (group === "ALL" || row.group === group)), [rows, filter, group]);
  const waitingVisible = visible.filter((row) => row.approval === "WAITING");
  const selectedIds = [...selected].filter((id) => rows.some((row) => row.id === id && row.approval === "WAITING"));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function decide(decision: "APPROVE" | "DECLINE") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/staff-invitations/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, ids: selectedIds }),
      });
      const body = await response.json().catch(() => ({})) as {
        message?: string;
        result?: { decided: number; skipped: number; failed: number; meals?: { planFound: boolean; entitledPeople: number; failedPeople: number } };
      };
      if (!response.ok || !body.result) throw new Error(body.message ?? "That couldn't be done. Nothing was changed.");
      const { decided, skipped, failed, meals } = body.result;
      const parts = [`${decided} ${decision === "APPROVE" ? "approved" : "declined"}`];
      if (skipped > 0) parts.push(`${skipped} skipped (no longer waiting)`);
      if (failed > 0) parts.push(`${failed} could not be changed, try them again`);
      if (decision === "APPROVE" && meals) {
        parts.push(meals.planFound
          ? `${meals.entitledPeople} ${meals.entitledPeople === 1 ? "person" : "people"} given the conference-paid meal plan${meals.failedPeople > 0 ? `, ${meals.failedPeople} could not be (check the Meals screen)` : ""}`
          : "this event has no single conference-paid meal plan, so meals were not covered");
      }
      setNotice(`${parts.join("; ")}.`);
      setSelected(new Set());
      setPending(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That couldn't be done. Nothing was changed.");
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

      <div className="panel selection-bar">
        <span role="status">{selectedIds.length > 0 ? <><strong>{selectedIds.length}</strong> selected</> : "Tick registrations, or use Select all."}</span>
        <div className="selection-bar-actions">
          {waitingVisible.length > 0 && selectedIds.length < waitingVisible.length && (
            <button className="text-button" onClick={() => setSelected(new Set(waitingVisible.map((row) => row.id)))} type="button">Select all {waitingVisible.length} waiting</button>
          )}
          {selectedIds.length > 0 && (
            <>
              <button className="text-button" onClick={() => { setSelected(new Set()); setPending(null); }} type="button">Clear selection</button>
              <button className="primary-button" disabled={busy} onClick={() => setPending("APPROVE")} type="button"><CheckCircle2 aria-hidden="true" size={16} /> Approve…</button>
              <button className="secondary-button outline-action" disabled={busy} onClick={() => setPending("DECLINE")} type="button"><XCircle aria-hidden="true" size={16} /> Decline…</button>
            </>
          )}
        </div>
      </div>

      {pending && (
        <div className="staff-invite-preview" role="alertdialog" aria-label={pending === "APPROVE" ? "Confirm approval" : "Confirm decline"}>
          <p>
            {pending === "APPROVE"
              ? `Approve ${selectedIds.length} registration${selectedIds.length === 1 ? "" : "s"}? Each becomes a confirmed registration at no charge, its confirmation email is queued in the outbox, and every person in it is given the conference-paid meal plan.`
              : `Decline ${selectedIds.length} registration${selectedIds.length === 1 ? "" : "s"}? Each is cancelled and its link cannot be used again. Its registrant is sent the usual cancellation notice.`}
          </p>
          <div className="intro-actions">
            <button className="primary-button" disabled={busy} onClick={() => void decide(pending)} type="button">{busy ? "Working…" : pending === "APPROVE" ? `Approve ${selectedIds.length}` : `Decline ${selectedIds.length}`}</button>
            <button className="text-button" onClick={() => setPending(null)} type="button">Cancel</button>
          </div>
        </div>
      )}
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}

      {visible.length === 0 ? (
        <section className="panel empty-state"><h3>Nothing here</h3><p>No registrations match. People appear here after they register through their personal link.</p></section>
      ) : (
        <div className="report-table-wrap">
          <table className="report-table staff-invite-table">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Select</span></th>
                <th scope="col">Registration</th>
                <th scope="col">Group</th>
                <th scope="col">Party</th>
                <th scope="col">Housing request</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.approval === "WAITING" && <input aria-label={`Select ${row.confirmationCode}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} type="checkbox" />}
                  </td>
                  <td>
                    <strong>{row.name || row.email}</strong>
                    <br /><span className="field-help">{row.confirmationCode} · {row.email}</span>
                    <br /><span className="field-help">Registered {row.registeredAt.slice(0, 16).replace("T", " ")} UTC</span>
                  </td>
                  <td>{STAFF_INVITATION_GROUP_LABEL[row.group]}</td>
                  <td>
                    <ul className="staff-invite-party">
                      {row.party.map((person, index) => (
                        <li key={`${row.id}-${index}`}>{person.name} <span className="field-help">({roleLabel[person.role] ?? person.role}{person.age !== null ? `, age ${person.age}` : ""})</span></li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    {row.needsHousing === null ? "—" : row.needsHousing ? "Needs on-site housing" : "No housing needed"}
                    {row.housingNote && <><br /><span className="field-help">{row.housingNote}</span></>}
                  </td>
                  <td><span className={`status-chip ${row.approval === "APPROVED" ? "green" : row.approval === "DECLINED" ? "coral" : "gold"}`}>{row.approval === "WAITING" ? "Waiting for approval" : row.approval === "APPROVED" ? "Approved" : "Declined"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
