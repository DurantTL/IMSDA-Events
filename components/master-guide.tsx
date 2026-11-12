"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { NavigationLink as Link } from "@/components/navigation-link";
import { SubmitButton } from "@/components/submit-button";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import {
  BIRTH_DATE_NEEDED,
  formatMasterGuideDate,
  masterGuideStatusLabels,
  MASTER_GUIDE_MENTOR_MAX_LENGTH,
  type MasterGuideWindow,
} from "@/modules/master-guide/domain";
import type { AreaApprovalRow, MasterGuideList, MasterGuideRow } from "@/modules/master-guide/repository";
import styles from "./master-guide.module.css";

/**
 * Master Guide tracking (#1698): the club's candidate list for the director and deputy, and the Area Coordinator's list of
 * candidates waiting for their approval. The routes check the role, the feature and the order of the steps again; nothing
 * here decides who may do what. No birth date is ever shown, only that one is needed.
 */

type Result = { message?: string };

async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as Result;
    throw new Error(result.message ?? "That could not be saved.");
  }
}

function WindowFacts({ window }: { window: MasterGuideWindow | null }) {
  if (!window) return null;
  return (
    <>
      <div><dt>Earliest finish</dt><dd>{formatMasterGuideDate(window.earliestFinish)}</dd></div>
      <div><dt>Latest finish</dt><dd>{formatMasterGuideDate(window.latestFinish)}</dd></div>
    </>
  );
}

function PastWindow({ window }: { window: MasterGuideWindow | null }) {
  if (!window?.pastWindow) return null;
  return <p className={styles.flag}>Past the 3-year window</p>;
}

function CandidateCard({ organizationId, row }: { organizationId: string; row: MasterGuideRow }) {
  const router = useRouter();
  const base = `/api/attendee/clubs/${encodeURIComponent(organizationId)}/master-guide/${encodeURIComponent(row.id)}`;
  const [startedOn, setStartedOn] = useState(row.startedOn);
  const [mentor, setMentor] = useState(row.mentorName ?? "");
  const [busy, setBusy] = useState<"" | "save" | "approve" | "remove">("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = row.status === "IN_PROGRESS" && (startedOn !== row.startedOn || mentor !== (row.mentorName ?? ""));
  useUnsavedChangesGuard(dirty, "You have unsaved changes to this candidate. Leave this page and discard them?");

  async function run(kind: "save" | "approve" | "remove", action: () => Promise<void>, done: string) {
    setBusy(kind);
    setError("");
    setRemoveError("");
    setNotice("");
    try {
      await action();
      setNotice(done);
      setConfirmRemove(false);
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "That could not be saved.";
      if (kind === "remove") setRemoveError(message);
      else setError(notSavedMessage(message));
    } finally {
      setBusy("");
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run("save", () => send(base, "PATCH", { startedOn, mentorName: mentor }), savedMessage());
  }

  return (
    <li className={styles.card}>
      <h3 className={styles.name}>{row.name}</h3>
      <span className={styles.status}>{masterGuideStatusLabels[row.status]}</span>
      <dl className={styles.facts}>
        <div><dt>Started</dt><dd>{formatMasterGuideDate(row.startedOn)}</dd></div>
        <div><dt>Mentor</dt><dd>{row.mentorName ?? "Not set"}</dd></div>
        <WindowFacts window={row.window} />
        {row.clubApprovedOn && <div><dt>Club approved</dt><dd>{formatMasterGuideDate(row.clubApprovedOn)}</dd></div>}
        {row.areaApprovedOn && <div><dt>Area Coordinator approved</dt><dd>{formatMasterGuideDate(row.areaApprovedOn)}</dd></div>}
      </dl>
      <PastWindow window={row.window} />
      {row.status === "IN_PROGRESS" && (
        <>
          {row.approvalProblem && (
            <p className={styles.note}>
              {row.approvalProblem}
              {row.approvalProblem === BIRTH_DATE_NEEDED && <> <Link href={`/account/clubs/${organizationId}/roster`}>Open the roster</Link> to add it.</>}
            </p>
          )}
          <div className={styles.actions}>
            {!row.approvalProblem && (
              <button className="primary-button" disabled={busy !== ""} onClick={() => void run("approve", () => send(`${base}/approve`, "POST"), "Approved for the club.")} type="button">
                {busy === "approve" ? "Approving…" : "Approve for the club"}
              </button>
            )}
            <button className="secondary-button" disabled={busy !== ""} onClick={() => { setRemoveError(""); setConfirmRemove(true); }} type="button">Remove</button>
          </div>
          <details className={styles.edit}>
            <summary>Edit start date and mentor</summary>
            <form className={styles.form} onSubmit={save}>
              <label className={styles.field}>Start date
                <input onChange={(event) => setStartedOn(event.target.value)} required type="date" value={startedOn} />
              </label>
              <label className={styles.field}>Mentor (optional)
                <input maxLength={MASTER_GUIDE_MENTOR_MAX_LENGTH} onChange={(event) => setMentor(event.target.value)} type="text" value={mentor} />
              </label>
              <div><SubmitButton label="Save" submitting={busy === "save"} submittingLabel="Saving…" /></div>
            </form>
          </details>
        </>
      )}
      {(error || notice) && <FormMessage message={error || notice} tone={error ? "error" : "success"} />}
      <ConfirmDialog
        busy={busy === "remove"}
        busyLabel="Removing…"
        confirmLabel={`Remove ${row.name}`}
        destructive
        error={removeError}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void run("remove", () => send(base, "DELETE"), "Removed.")}
        open={confirmRemove}
        title={`Remove ${row.name} as a Master Guide candidate?`}
      >
        <p>They come off this list. Their roster entry is not changed. You can add them again later.</p>
      </ConfirmDialog>
    </li>
  );
}

/** The club's list, the add form and the director's Approve for the club action. */
export function MasterGuideCandidates({ organizationId, list }: { organizationId: string; list: MasterGuideList }) {
  const router = useRouter();
  const [personId, setPersonId] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [mentor, setMentor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = personId !== "" || startedOn !== "" || mentor !== "";
  useUnsavedChangesGuard(dirty, "You have an unsaved candidate. Leave this page and discard it?");

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await send(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/master-guide`, "POST", { personId, startedOn, mentorName: mentor });
      setPersonId("");
      setStartedOn("");
      setMentor("");
      setNotice(savedMessage("The candidate is on the list."));
      router.refresh();
    } catch (caught) {
      setError(notSavedMessage(caught instanceof Error ? caught.message : "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {list.eligible.length > 0 ? (
        <form className={styles.addForm} onSubmit={add}>
          <label className={styles.field}>Person on the roster
            <select onChange={(event) => setPersonId(event.target.value)} required value={personId}>
              <option value="">Choose a person</option>
              {list.eligible.map((person) => <option key={person.personId} value={person.personId}>{person.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>Start date
            <input onChange={(event) => setStartedOn(event.target.value)} required type="date" value={startedOn} />
          </label>
          <label className={styles.field}>Mentor (optional)
            <input maxLength={MASTER_GUIDE_MENTOR_MAX_LENGTH} onChange={(event) => setMentor(event.target.value)} type="text" value={mentor} />
          </label>
          <div><SubmitButton label="Add candidate" submitting={busy} submittingLabel="Adding…" /></div>
        </form>
      ) : (
        <p className={styles.note}>Nobody on this year&apos;s active roster is available to add. A candidate must be 16 or older.</p>
      )}
      <FormMessage message={error || notice} tone={error ? "error" : "success"} />
      {list.needBirthDate.length > 0 && (
        <p className={styles.note}>
          Birth date needed on the roster before they can be added: {list.needBirthDate.join(", ")}.{" "}
          <Link href={`/account/clubs/${organizationId}/roster`}>Open the roster</Link> to add it.
        </p>
      )}
      {list.unreadableBirthDate.length > 0 && (
        <p className={styles.note}>
          The birth date on the roster could not be read for: {list.unreadableBirthDate.join(", ")}. Ask the conference office.
        </p>
      )}
      {list.rows.length === 0 ? (
        <p className={styles.empty}>No Master Guide candidates yet.</p>
      ) : (
        <ul className={styles.list}>
          {list.rows.map((row) => <CandidateCard key={row.id} organizationId={organizationId} row={row} />)}
        </ul>
      )}
    </>
  );
}

function AreaCard({ row }: { row: AreaApprovalRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function approve() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await send("/api/attendee/area-clubs/master-guide/approve", "POST", { candidateId: row.id });
      setNotice("Approved.");
      router.refresh();
    } catch (caught) {
      setError(notSavedMessage(caught instanceof Error ? caught.message : "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.card}>
      <h3 className={styles.name}>{row.name}</h3>
      <dl className={styles.facts}>
        <div><dt>Club</dt><dd>{row.clubName}</dd></div>
        <div><dt>Started</dt><dd>{formatMasterGuideDate(row.startedOn)}</dd></div>
        <div><dt>Mentor</dt><dd>{row.mentorName ?? "Not set"}</dd></div>
        <WindowFacts window={row.window} />
        {row.clubApprovedOn && <div><dt>Club approved</dt><dd>{formatMasterGuideDate(row.clubApprovedOn)}</dd></div>}
      </dl>
      <PastWindow window={row.window} />
      <div className={styles.actions}>
        <button className="primary-button" disabled={busy} onClick={() => void approve()} type="button">
          {busy ? "Approving…" : `Approve ${row.name}`}
        </button>
      </div>
      {(error || notice) && <FormMessage message={error || notice} tone={error ? "error" : "success"} />}
    </li>
  );
}

/** The Area Coordinator's list of candidates the club has approved. Approve is the only action. */
export function MasterGuideAreaApprovals({ rows }: { rows: AreaApprovalRow[] }) {
  if (rows.length === 0) return <p className={styles.empty}>No Master Guide candidates are waiting for your approval.</p>;
  return <ul className={styles.list}>{rows.map((row) => <AreaCard key={row.id} row={row} />)}</ul>;
}
