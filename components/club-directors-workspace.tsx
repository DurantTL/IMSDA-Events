"use client";

import { useConfirm } from "@/components/use-confirm";
import { SubmitButton } from "@/components/submit-button";
import { cardCell } from "@/components/table-card-labels";
import Link from "next/link";
import { useState } from "react";
import { clubRoleText } from "@/modules/access/role-descriptions";
import { Ban, UserCog, UserPlus } from "lucide-react";
import {
  clubDirectorRoleLabels,
  directorGrantStatusLabels,
  type DirectorGrantStatus,
} from "@/modules/organizations/director-grants-domain";
import type { DirectorGrantRecord } from "@/modules/organizations/director-grants-repository";
import styles from "@/components/club-directors-workspace.module.css";

type GrantResponse = {
  grants?: DirectorGrantRecord[];
  /** The person just given a role: names and a yes or no only (#1410). */
  granted?: { displayName: string; email: string; twoStepOn: boolean; emailQueued: boolean } | null;
  message?: string;
  issues?: Array<{ message?: string }>;
};

const statusTone: Record<DirectorGrantStatus, string> = {
  ACTIVE: "green",
  SCHEDULED: "purple",
  ENDED: "gold",
  REVOKED: "coral",
};

function firstName(displayName: string) {
  return displayName.trim().split(/\s+/)[0] || "them";
}

function formatDate(value: string | null) {
  if (!value) return "No end date";
  return new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" });
}

/** `<input type="date">` gives a calendar day; grants start and end at local midnight. */
function dateInputToIso(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  return new Date(`${text}T00:00:00`).toISOString();
}

export function ClubDirectorsWorkspace({
  club,
  initialGrants,
  canOpenPeople = false,
}: {
  club: { id: string; name: string; isActive: boolean };
  initialGrants: DirectorGrantRecord[];
  /** Whether the viewer may open People & access (#1277): each person then links to their page. The server decides again. */
  canOpenPeople?: boolean;
}) {
  const [grants, setGrants] = useState(initialGrants);
  const [saving, setSaving] = useState(false);
  const { ask, confirmDialog } = useConfirm();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [given, setGiven] = useState<NonNullable<GrantResponse["granted"]> | null>(null);
  const base = `/api/admin/organizations/${encodeURIComponent(club.id)}/director-grants`;

  async function readResponse(response: Response): Promise<GrantResponse> {
    const result = await response.json().catch(() => ({})) as GrantResponse;
    if (!response.ok || !result.grants) {
      throw new Error(
        result.message ?? result.issues?.[0]?.message ?? "Club directors could not be updated.",
      );
    }
    setGrants(result.grants);
    return result;
  }

  async function addDirector(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setError("");
    setNotice("");
    setGiven(null);
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          role: String(form.get("role") ?? "DIRECTOR"),
          effectiveFrom: dateInputToIso(form.get("effectiveFrom")),
          effectiveTo: dateInputToIso(form.get("effectiveTo")) ?? null,
          reason: String(form.get("reason") ?? ""),
        }),
      });
      const result = await readResponse(response);
      formElement.reset();
      setGiven(result.granted ?? null);
      setNotice(result.granted ? "" : "Role given. They will see this club under My club on their account.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The director could not be assigned.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(grant: DirectorGrantRecord) {
    const reason = await ask({
      title: `Revoke ${grant.account.displayName}'s access to ${club.name}?`,
      body: <p>{`${grant.account.displayName} will lose this club access. The reason is recorded in the audit log.`}</p>,
      confirmLabel: `Revoke access for ${grant.account.displayName}`,
      destructive: true,
      input: { label: `Why is ${grant.account.displayName} losing access to ${club.name}?`, required: true, minLength: 3, maxLength: 500, hint: "At least 3 characters." },
    });
    if (reason === null) return;
    setSaving(true);
    setError("");
    setNotice("");
    setGiven(null);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(grant.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      await readResponse(response);
      setNotice("Club access revoked.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The grant could not be revoked.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-stack">
      {confirmDialog}
      <div className="page-intro">
        <div>
          <p className="eyebrow">Club admins</p>
          <h2 translate="no">{club.name}</h2>
          <p>
            {clubRoleText.DIRECTOR.name}, {clubRoleText.DEPUTY.name}, {clubRoleText.REGISTRAR.name}
            and {clubRoleText.REPORTER.name} sign in with their own attendee account.
            A {clubRoleText.DIRECTOR.name} or {clubRoleText.DEPUTY.name} can also give and remove the{" "}
            {clubRoleText.REGISTRAR.name} and {clubRoleText.REPORTER.name} roles themselves.
            Every grant and revocation is recorded in the audit log.
          </p>
        </div>
      </div>

      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {given && (
        <div className="inline-notice success" role="status">
          <strong>Role given to <span translate="no">{given.displayName}</span> (<span translate="no">{given.email}</span>).</strong>
          <p className={styles.givenCopy}>
            {given.emailQueued
              ? <>We emailed {firstName(given.displayName)}. Their own registrations open right away.</>
              : <>Email isn&apos;t set up on this server, so we didn&apos;t email {firstName(given.displayName)}. Their own registrations open right away.</>}
            {given.twoStepOn
              ? null
              : <> Before they can open club pages, they&apos;ll set up two-step sign-in. It takes about two minutes, and we walk them through it.</>}
          </p>
          {!given.twoStepOn && <span className="status-chip gold">Two-step sign-in: not set up yet</span>}
        </div>
      )}
      {error && <div className="inline-notice error" role="alert">{error}</div>}

      {club.isActive ? (
        <form className="panel form-stack" onSubmit={addDirector}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">New grant</p>
              <h2>Give a club role</h2>
            </div>
          </div>
          <div className="form-grid two-column">
            <label>
              Account email
              <input autoComplete="off" name="email" required type="email" />
            </label>
            <label>
              Role
              <select defaultValue="DIRECTOR" name="role">
                {Object.entries(clubDirectorRoleLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Starts (optional, defaults to today)
              <input name="effectiveFrom" type="date" />
            </label>
            <label>
              Ends (optional)
              <input name="effectiveTo" type="date" />
            </label>
          </div>
          <label>
            Reason
            <input maxLength={500} minLength={3} name="reason" placeholder="e.g. 2026–27 Pathfinder director per church board" required />
          </label>
          <p className="field-help">
            The person needs a verified account first. If they don&apos;t have one,
            ask them to create one at /account/sign-up.
          </p>
          <div>
            <SubmitButton className="primary-button" icon={<UserPlus aria-hidden="true" size={16} />} label="Give role" submitting={saving} submittingLabel="Giving…" />
          </div>
        </form>
      ) : (
        <div className="inline-notice error" role="status">
          This club is inactive. Reactivate it before assigning a director.
        </div>
      )}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Access history</p>
            <h2>Grants</h2>
          </div>
          <span className="count-badge">{`${grants.length} total`}</span>
        </div>
        {grants.length === 0 ? (
          <div className="empty-state">
            <UserCog aria-hidden="true" size={27} />
            <h3>No directors yet</h3>
            <p>Assign the club director so they can manage the roster.</p>
          </div>
        ) : (
          <div className="report-table-wrap card-box">
          <table className="report-table table-cards table-cards-tablet" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Person</th>
                <th role="columnheader" scope="col">Role</th>
                <th role="columnheader" scope="col">Dates</th>
                <th role="columnheader" scope="col">Status</th>
                <th role="columnheader" scope="col">Reason</th>
                <th role="columnheader" scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {grants.map((grant) => (
                <tr key={grant.id} role="row">
                  <th role="rowheader" scope="row">
                    <strong translate="no">{grant.account.displayName}</strong>
                    <br />
                    <small translate="no">{grant.account.email}</small>
                    {(grant.status === "ACTIVE" || grant.status === "SCHEDULED") && (
                      <>
                        <br />
                        <span className={`status-chip ${grant.twoStepOn ? "green" : "gold"}`}>
                          {grant.twoStepOn ? "Two-step on" : "Two-step not set up"}
                        </span>
                      </>
                    )}
                    {canOpenPeople ? (
                      <>
                        <br />
                        <Link className="secondary-button" href={`/admin/people/account/${grant.account.id}`}>See all of this person&apos;s access<span className="sr-only"> ({grant.account.displayName})</span></Link>
                      </>
                    ) : null}
                  </th>
                  <td {...cardCell("Role")}>{clubDirectorRoleLabels[grant.role]}</td>
                  <td {...cardCell("Dates")}>{formatDate(grant.effectiveFrom)} – {formatDate(grant.effectiveTo)}</td>
                  <td {...cardCell("Status")}>
                    <span className={`status-chip ${statusTone[grant.status]}`}>
                      {directorGrantStatusLabels[grant.status]}
                    </span>
                  </td>
                  <td {...cardCell("Reason")}>
                    {grant.reason}
                    {grant.revokeReason && (
                      <>
                        <br />
                        <small>{`Revoked: ${grant.revokeReason}`}</small>
                      </>
                    )}
                  </td>
                  <td {...cardCell(null)}>
                    {grant.status !== "REVOKED" && (
                      <button
                        aria-label={`Revoke ${grant.account.displayName}`}
                        className="secondary-button"
                        disabled={saving}
                        onClick={() => revoke(grant)}
                        type="button"
                      >
                        <Ban aria-hidden="true" size={14} /> Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </section>
  );
}
