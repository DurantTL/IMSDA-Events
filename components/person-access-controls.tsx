"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useConfirm } from "@/components/use-confirm";
import {
  HAND_LINK_NOTE_MAX,
  HAND_LINK_REASON_CODES,
  HAND_LINK_REASON_LABELS,
  type HandLinkReasonCode,
} from "@/modules/account-merge/hand-link-reasons";
import { eventRoles, type EventRole } from "@/modules/access/permissions";
import { roleLabel } from "@/modules/access/role-display";
import { RoleDetails } from "@/components/role-details";
import { systemRoleText } from "@/modules/access/role-descriptions";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";
import styles from "./people-directory.module.css";

/**
 * The People & access controls (#1275 round b). Each one calls the route the old Team, Accounts, event Staff and club
 * directors pages called, then refreshes the server data and says what happened in a polite live region. The server
 * decides every request; the page only renders a control for a viewer the route would admit.
 */

async function callJson(url: string, init: RequestInit & { json?: unknown }, fallback: string): Promise<{ message?: string }> {
  const { json, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    headers: json === undefined ? rest.headers : { "Content-Type": "application/json", ...rest.headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const result = await response.json().catch(() => ({})) as { message?: string; issues?: Array<{ message?: string }> };
  if (!response.ok) throw new Error(result.message ?? result.issues?.[0]?.message ?? fallback);
  return result;
}

function useChange() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** Runs `work`, which returns the message to show. Resolves to the error message, or null on success. */
  async function run(work: () => Promise<string>, fallback: string): Promise<string | null> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await work());
      router.refresh();
      return null;
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : fallback;
      setError(text);
      return text;
    } finally {
      setBusy(false);
    }
  }
  const status = (
    <div className={styles.status}>
      <p aria-live="polite" role="status">{message}</p>
      {error ? <p className={styles.statusError} role="alert">{error}</p> : null}
    </div>
  );
  return { busy, run, status };
}

function Chip({ tone, children }: { tone?: "green" | "coral"; children: ReactNode }) {
  return <span className={`${styles.chip} ${tone ? styles[tone] : styles.kind}`}>{children}</span>;
}

// ---------------------------------------------------------------- System-wide

type RoleKind = "system-administrator" | "clubs-administrator" | "area-coordinator";

const roleKeys = { "system-administrator": "SYSTEM_ADMIN", "clubs-administrator": "CLUBS_ADMIN", "area-coordinator": "AREA_COORDINATOR" } as const;

const roleCopy: Record<RoleKind, { grantNote: string | null; revokeBody: string; noun: string }> = {
  "system-administrator": {
    noun: systemRoleText.SYSTEM_ADMIN.name.toLowerCase(),
    grantNote: "Grant this only to someone who must.",
    revokeBody: "They lose system administrator access on their next request. The last system administrator cannot be removed.",
  },
  "clubs-administrator": {
    noun: systemRoleText.CLUBS_ADMIN.name,
    grantNote: "Every change is recorded under their name.",
    revokeBody: "They lose access to the club areas on their next page. Nothing they did is undone.",
  },
  "area-coordinator": {
    noun: systemRoleText.AREA_COORDINATOR.name,
    grantNote: null,
    revokeBody: "They'll no longer see other clubs.",
  },
};

/** One system-wide role: its state and the one button that changes it. Rendered only when the route would admit the viewer. */
export function RoleToggle({ kind, on, name, userId, accountId }: {
  kind: RoleKind;
  on: boolean;
  name: string;
  userId?: string;
  accountId?: string;
}) {
  const { busy, run, status } = useChange();
  const { confirm, confirmDialog } = useConfirm();
  const copy = roleCopy[kind];
  const grant = !on;

  async function change() {
    if (!(await confirm({
      title: grant ? `Make ${name} a ${copy.noun}?` : `Remove ${copy.noun} from ${name}?`,
      body: grant ? (
        <>
          <p>{systemRoleText[roleKeys[kind]].summary}{copy.grantNote ? ` ${copy.grantNote}` : ""}</p>
          <RoleDetails role={systemRoleText[roleKeys[kind]]} />
        </>
      ) : <p>{copy.revokeBody}</p>,
      confirmLabel: grant ? `Make ${name} a ${copy.noun}` : `Remove ${copy.noun} from ${name}`,
      destructive: !grant,
    }))) return;
    await run(async () => {
      if (kind === "system-administrator") {
        await callJson(`/api/users/${encodeURIComponent(userId ?? "")}/global-role`, { method: "PATCH", json: { globalRole: grant ? "SYSTEM_ADMIN" : null } }, "The system role could not be changed.");
        return grant ? `${name} is now a system administrator.` : `${name} is no longer a system administrator.`;
      }
      if (kind === "clubs-administrator") {
        await callJson(`/api/admin/users/${encodeURIComponent(userId ?? "")}/clubs-administrator`, { method: grant ? "PUT" : "DELETE" }, "That role could not be changed.");
        return grant ? `${name} is now a Clubs Administrator.` : `${name} is no longer a Clubs Administrator.`;
      }
      const result = await callJson(`/api/admin/accounts/${encodeURIComponent(accountId ?? "")}`, { method: "POST", json: { action: "area-coordinator", on: grant } }, "That role could not be changed.");
      return result.message ?? (grant ? "Now an Area Coordinator." : "No longer an Area Coordinator.");
    }, "That role could not be changed.");
  }

  return (
    <>
      {confirmDialog}
      <Chip tone={on ? "green" : undefined}>{on ? "On" : "Off"}</Chip>
      <button
        aria-label={`${grant ? "Make" : "Remove"} ${copy.noun}: ${name}`}
        className="secondary-button"
        disabled={busy}
        onClick={() => void change()}
        type="button"
      >
        {grant ? `Make ${copy.noun}` : `Remove ${copy.noun}`}
      </button>
      {status}
    </>
  );
}

// ---------------------------------------------------------------- Events

export type EventMembershipView = {
  membershipId: string;
  eventId: string;
  eventName: string;
  role: string;
  active: boolean;
  healthInformation: boolean;
  finalizeInvoices: boolean;
};

/** One event membership: role and access (removal keeps the row as inactive), plus the two extras. */
export function EventMembershipControls({ membership, targetIsSystemAdministrator, name }: {
  membership: EventMembershipView;
  targetIsSystemAdministrator: boolean;
  name: string;
}) {
  const { busy, run, status } = useChange();
  const [role, setRole] = useState(membership.role);
  const [access, setAccess] = useState(membership.active ? "ACTIVE" : "INACTIVE");
  const base = `/api/events/${encodeURIComponent(membership.eventId)}/memberships/${encodeURIComponent(membership.membershipId)}`;
  const dirty = role !== membership.role || (access === "ACTIVE") !== membership.active;

  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await callJson(base, { method: "PATCH", json: { role, status: access } }, "The staff assignment could not be updated.");
      return access === "ACTIVE" ? `Saved ${name}'s access to ${membership.eventName}.` : `${name} no longer has access to ${membership.eventName}. The record is kept.`;
    }, "The staff assignment could not be updated.");
  }

  async function extra(path: "health-access" | "invoice-finalization-access", granted: boolean, label: string) {
    await run(async () => {
      await callJson(`${base}/${path}`, { method: "PUT", json: { granted } }, `${label} could not be changed.`);
      return `${label} ${granted ? "given to" : "removed from"} ${name} for ${membership.eventName}.`;
    }, `${label} could not be changed.`);
  }

  return (
    <li className={styles.control}>
      <strong className={styles.controlTitle}>{membership.eventName}</strong>
      <form className={styles.inline} onSubmit={(event) => void save(event)}>
        <label className={styles.field}>
          <span>Role in {membership.eventName}</span>
          <select onChange={(event) => setRole(event.target.value)} value={role}>
            {eventRoles.map((value: EventRole) => <option key={value} value={value}>{roleLabel(value)}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Access to {membership.eventName}</span>
          <select onChange={(event) => setAccess(event.target.value)} value={access}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Removed (keeps the record)</option>
          </select>
        </label>
        <button className="secondary-button" disabled={busy || !dirty} type="submit">Save</button>
      </form>
      {targetIsSystemAdministrator ? (
        <p className={styles.note}>A system administrator has every permission on every event.</p>
      ) : (
        <div className={styles.inline}>
          <button
            aria-pressed={membership.healthInformation}
            className="secondary-button"
            disabled={busy}
            onClick={() => void extra("health-access", !membership.healthInformation, "Health information access")}
            type="button"
          >
            {membership.healthInformation ? "Remove health information" : "Give health information"}
          </button>
          {membership.active ? (
            <button
              aria-pressed={membership.finalizeInvoices}
              className="secondary-button"
              disabled={busy}
              onClick={() => void extra("invoice-finalization-access", !membership.finalizeInvoices, "Permission to finalize invoices")}
              type="button"
            >
              {membership.finalizeInvoices ? "Remove finalize invoices" : "Give finalize invoices"}
            </button>
          ) : null}
        </div>
      )}
      {status}
    </li>
  );
}

/** Add this staff login to another event (`POST /api/events/[eventId]/memberships`, which takes the email and name). */
export function AddToEvent({ email, displayName, events }: {
  email: string;
  displayName: string;
  events: ReadonlyArray<{ id: string; name: string }>;
}) {
  const { busy, run, status } = useChange();
  const [eventId, setEventId] = useState("");
  const [role, setRole] = useState<string>("READ_ONLY_STAFF");

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!eventId) return;
    const eventName = events.find((candidate) => candidate.id === eventId)?.name ?? "the event";
    const failure = await run(async () => {
      await callJson(`/api/events/${encodeURIComponent(eventId)}/memberships`, { method: "POST", json: { email, displayName, role } }, "The staff assignment could not be saved.");
      return `Added ${displayName} to ${eventName}.`;
    }, "The staff assignment could not be saved.");
    if (failure === null) setEventId("");
  }

  if (events.length === 0) return <p className={styles.note}>Already on every open event.</p>;
  return (
    <form className={styles.inline} onSubmit={(event) => void add(event)}>
      <label className={styles.field}>
        <span>Add to event</span>
        <select onChange={(event) => setEventId(event.target.value)} value={eventId}>
          <option value="">Choose an event</option>
          {events.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span>Role in the new event</span>
        <select onChange={(event) => setRole(event.target.value)} value={role}>
          {eventRoles.map((value: EventRole) => <option key={value} value={value}>{roleLabel(value)}</option>)}
        </select>
      </label>
      <button className="primary-button" disabled={busy || !eventId} type="submit">Add to event</button>
      {status}
    </form>
  );
}

// ---------------------------------------------------------------- Clubs

/** Revoke one club role (`PATCH .../director-grants/[grantId]`, which needs a reason). */
export function RevokeClubRole({ organizationId, grantId, clubName, roleName, name }: {
  organizationId: string;
  grantId: string;
  clubName: string;
  roleName: string;
  name: string;
}) {
  const { busy, run, status } = useChange();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function revoke() {
    setError("");
    const failure = await run(async () => {
      await callJson(`/api/admin/organizations/${encodeURIComponent(organizationId)}/director-grants/${encodeURIComponent(grantId)}`, { method: "PATCH", json: { reason } }, "The role could not be revoked.");
      return `${name} no longer has the ${roleName} role for ${clubName}.`;
    }, "The role could not be revoked.");
    if (failure === null) { setOpen(false); setReason(""); } else setError(failure);
  }

  return (
    <>
      <button aria-label={`Revoke ${roleName} for ${clubName}`} className="secondary-button" disabled={busy} onClick={() => { setError(""); setOpen(true); }} type="button">Revoke</button>
      {status}
      <ConfirmDialog
        busy={busy}
        confirmDisabled={reason.trim().length < 3}
        confirmLabel={`Revoke ${roleName} for ${clubName}`}
        destructive
        error={error}
        onCancel={() => setOpen(false)}
        onConfirm={() => void revoke()}
        open={open}
        title={`Revoke ${roleName} for ${clubName}?`}
      >
        <p>{name} loses this club role. The record is kept.</p>
        <label>
          Reason (at least 3 characters)
          <input maxLength={500} onChange={(event) => setReason(event.target.value)} value={reason} />
        </label>
      </ConfirmDialog>
    </>
  );
}

/** Give a club role to this website account (`POST .../director-grants`, which finds the account by email). */
export function AddClubRole({ accountEmail, name, clubs }: {
  accountEmail: string;
  name: string;
  clubs: ReadonlyArray<{ id: string; name: string }>;
}) {
  const { busy, run, status } = useChange();
  const [organizationId, setOrganizationId] = useState("");
  const [role, setRole] = useState<ClubRole>("DIRECTOR");
  const [reason, setReason] = useState("");

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    const clubName = clubs.find((club) => club.id === organizationId)?.name ?? "the club";
    const failure = await run(async () => {
      await callJson(`/api/admin/organizations/${encodeURIComponent(organizationId)}/director-grants`, { method: "POST", json: { email: accountEmail, role, reason } }, "The role could not be given.");
      return `${name} is now ${clubDirectorRoleLabels[role]} for ${clubName}.`;
    }, "The role could not be given.");
    if (failure === null) { setReason(""); setOrganizationId(""); }
  }

  return (
    <form className={styles.inline} onSubmit={(event) => void add(event)}>
      <label className={styles.field}>
        <span>Club</span>
        <select onChange={(event) => setOrganizationId(event.target.value)} value={organizationId}>
          <option value="">Choose a club</option>
          {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span>Club role</span>
        <select onChange={(event) => setRole(event.target.value as ClubRole)} value={role}>
          {(Object.keys(clubDirectorRoleLabels) as ClubRole[]).map((value) => <option key={value} value={value}>{clubDirectorRoleLabels[value]}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span>Reason</span>
        <input maxLength={500} onChange={(event) => setReason(event.target.value)} value={reason} />
      </label>
      <button className="primary-button" disabled={busy || !organizationId || reason.trim().length < 3} type="submit">Give club role</button>
      {status}
    </form>
  );
}

// ---------------------------------------------------------------- Account actions

type AccountForm = "change-staff-email" | "change-account-email" | "link" | "unlink" | "profile";

/** Sign-in actions, moved from the old Team and Accounts pages. System administrators only. */
export function AccountActions({ staff, account, isSelf, linkedEmailChangesTogether }: {
  staff: null | {
    id: string;
    email: string;
    displayName: string;
    jobTitle: string;
    phone: string;
    bio: string;
    signInDisabled: boolean;
    twoStepOn: boolean;
  };
  account: null | { id: string; email: string; emailVerified: boolean; twoStepOn: boolean };
  isSelf: boolean;
  linkedEmailChangesTogether: boolean;
}) {
  const { busy, run, status } = useChange();
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<AccountForm | null>(null);
  const [formError, setFormError] = useState("");
  const [email, setEmail] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [reason, setReason] = useState<HandLinkReasonCode>("DIFFERENT_STAFF_EMAIL");
  const [note, setNote] = useState("");
  const [profile, setProfile] = useState({ displayName: "", jobTitle: "", phone: "", bio: "" });

  const staffUrl = staff ? `/api/admin/users/${encodeURIComponent(staff.id)}` : "";
  const accountUrl = account ? `/api/admin/accounts/${encodeURIComponent(account.id)}` : "";

  function open(next: AccountForm) {
    setFormError("");
    setEmail(next === "change-staff-email" ? staff?.email ?? "" : account?.email ?? "");
    setStaffEmail("");
    setReason(next === "unlink" ? "WRONG_PERSON_LINKED" : "DIFFERENT_STAFF_EMAIL");
    setNote("");
    if (staff) setProfile({ displayName: staff.displayName, jobTitle: staff.jobTitle, phone: staff.phone, bio: staff.bio });
    setForm(next);
  }

  async function staffAction(body: Record<string, unknown>, fallback: string) {
    return run(async () => (await callJson(`${staffUrl}/actions`, { method: "POST", json: body }, fallback)).message ?? "Done.", fallback);
  }
  async function accountAction(body: Record<string, unknown>, fallback: string) {
    return run(async () => (await callJson(accountUrl, { method: "POST", json: body }, fallback)).message ?? "Done.", fallback);
  }

  async function confirmed(title: string, body: string, confirmLabel: string, act: () => Promise<unknown>) {
    if (await confirm({ title, body: <p>{body}</p>, confirmLabel, destructive: true })) await act();
  }

  async function submitForm() {
    if (!form) return;
    setFormError("");
    const handReason = { code: reason, note: note.trim() || undefined };
    if ((form === "link" || form === "unlink") && reason === "OTHER" && note.trim().length < 5) {
      setFormError("Add a note of at least 5 characters for \"Other\".");
      return;
    }
    let failure: string | null;
    if (form === "change-staff-email") failure = await staffAction({ action: "change-email", email }, "That email could not be changed.");
    else if (form === "change-account-email") failure = await accountAction({ action: "change-email", email }, "That email could not be changed.");
    else if (form === "link") failure = await accountAction({ action: "link-staff", staffEmail, reason: handReason }, "Those sign-ins could not be linked.");
    else if (form === "unlink") failure = await accountAction({ action: "unlink-staff", reason: handReason }, "Those sign-ins could not be unlinked.");
    else {
      failure = await run(async () => {
        await callJson(staffUrl, { method: "PATCH", json: profile }, "That team profile could not be updated.");
        return `Updated the profile for ${profile.displayName}.`;
      }, "That team profile could not be updated.");
    }
    if (failure === null) setForm(null);
    else setFormError(failure);
  }

  async function setDisabled(disabled: boolean) {
    if (!staff) return;
    const apply = () => run(async () => {
      await callJson(staffUrl, { method: "PATCH", json: { disabled } }, "That account could not be updated.");
      return disabled ? "Sign-in is off and their sessions were ended." : "They can sign in again.";
    }, "That account could not be updated.");
    if (disabled) await confirmed(`Disable sign-in for ${staff.displayName}?`, "Their sessions end immediately and they cannot sign in until this is undone.", `Disable ${staff.displayName}`, apply);
    else await apply();
  }

  const isChange = form === "change-staff-email" || form === "change-account-email";
  const title = form === "profile" ? `Edit the profile for ${staff?.displayName ?? ""}`
    : isChange ? `Change email for ${email}`
      : form === "link" ? `Link ${account?.email ?? ""} to a staff login`
        : form === "unlink" ? `Unlink ${account?.email ?? ""} from its staff login` : "";

  return (
    <div className={styles.controlsStack}>
      {confirmDialog}
      {staff ? (
        <div className={styles.control}>
          <strong className={styles.controlTitle}>Staff login</strong>
          <div className={styles.inline}>
            <button className="secondary-button" disabled={busy} onClick={() => open("profile")} type="button">Edit profile</button>
            <button className="secondary-button" disabled={busy} onClick={() => void staffAction({ action: "send-password-reset" }, "A reset link could not be sent.")} type="button">Send password reset</button>
            <button className="secondary-button" disabled={busy} onClick={() => open("change-staff-email")} type="button">Change staff email</button>
            {!isSelf && staff.twoStepOn ? (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void confirmed(`Reset two-step sign-in for ${staff.displayName}?`, "Their authenticator and passkeys are removed and they are signed out. They set it up again at their next sign-in.", `Reset two-step for ${staff.displayName}`, () => staffAction({ action: "reset-two-step" }, "Two-step could not be reset."))}
                type="button"
              >
                Reset staff two-step
              </button>
            ) : null}
            {isSelf ? (
              <span className={styles.note}>This is you, so you can&apos;t switch off your own sign-in.</span>
            ) : (
              <button className="secondary-button" disabled={busy} onClick={() => void setDisabled(!staff.signInDisabled)} type="button">
                {staff.signInDisabled ? "Allow sign-in" : "Disable sign-in"}
              </button>
            )}
          </div>
        </div>
      ) : null}
      {account ? (
        <div className={styles.control}>
          <strong className={styles.controlTitle}>Website account</strong>
          <div className={styles.inline}>
            {account.twoStepOn ? (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void confirmed(`Reset two-step sign-in for ${account.email}?`, "Their authenticator and passkeys are removed and they're signed out.", `Reset two-step for ${account.email}`, () => accountAction({ action: "reset-two-step" }, "Two-step could not be reset."))}
                type="button"
              >
                Reset website two-step
              </button>
            ) : null}
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void confirmed(`Sign ${account.email} out on every device?`, "This immediately ends every active session for this account.", `Sign ${account.email} out everywhere`, () => accountAction({ action: "sign-out" }, "That account could not be signed out."))}
              type="button"
            >
              Sign out everywhere
            </button>
            <button className="secondary-button" disabled={busy} onClick={() => open("change-account-email")} type="button">Change website email</button>
            {!account.emailVerified ? (
              <button className="secondary-button" disabled={busy} onClick={() => void accountAction({ action: "send-verification" }, "The verification email could not be sent.")} type="button">Send verification email</button>
            ) : null}
            <button className="secondary-button" disabled={busy} onClick={() => open(staff ? "unlink" : "link")} type="button">
              {staff ? "Unlink staff login" : "Link a staff login"}
            </button>
          </div>
        </div>
      ) : null}
      {status}

      <ConfirmDialog
        busy={busy}
        confirmLabel={form === "profile" ? "Save profile" : isChange ? "Change email" : form === "link" ? "Link sign-ins" : "Unlink sign-ins"}
        destructive={form === "unlink"}
        error={formError}
        onCancel={() => setForm(null)}
        onConfirm={() => void submitForm()}
        open={form !== null}
        title={title}
      >
        {form === "profile" ? (
          <>
            <label>Display name<input maxLength={100} minLength={2} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} value={profile.displayName} /></label>
            <label>Title or responsibility<input maxLength={120} onChange={(event) => setProfile({ ...profile, jobTitle: event.target.value })} value={profile.jobTitle} /></label>
            <label>Phone<input autoComplete="tel" maxLength={40} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} value={profile.phone} /></label>
            <label>Profile notes<textarea maxLength={1000} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} rows={4} value={profile.bio} /></label>
          </>
        ) : null}
        {isChange ? (
          <>
            {form === "change-account-email" ? (
              <p>Registrations are found by verified email. The new address starts unverified, the account is signed out everywhere, and codes already sent to the old address stop working. Use &ldquo;Send verification email&rdquo; afterwards.</p>
            ) : (
              <p>They are signed out everywhere and use the new address to sign in.</p>
            )}
            {staff && account && linkedEmailChangesTogether ? <p><strong>These sign-ins are linked, so this also changes the other email.</strong></p> : null}
            <label>New email<input maxLength={254} onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></label>
          </>
        ) : null}
        {form === "link" ? (
          <>
            <p>For a person whose staff login uses a different email. Linking gives no staff access: the staff login still signs in to the staff workspace only with its own password and second step.</p>
            <label>Staff login email<input maxLength={254} onChange={(event) => setStaffEmail(event.target.value)} type="email" value={staffEmail} /></label>
          </>
        ) : null}
        {form === "unlink" ? <p>Unlinking signs the account out everywhere, including website sessions opened through the link.</p> : null}
        {form === "link" || form === "unlink" ? (
          <>
            <label>
              Reason
              <select onChange={(event) => setReason(event.target.value as HandLinkReasonCode)} value={reason}>
                {HAND_LINK_REASON_CODES.map((code) => <option key={code} value={code}>{HAND_LINK_REASON_LABELS[code]}</option>)}
              </select>
            </label>
            <label>
              Note {reason === "OTHER" ? "(required, 5 to" : "(optional, up to"} {HAND_LINK_NOTE_MAX} characters; no personal details)
              <textarea maxLength={HAND_LINK_NOTE_MAX} onChange={(event) => setNote(event.target.value)} rows={3} value={note} />
            </label>
            <p className="field-help" style={{ margin: "4px 0 0" }}>{note.length}/{HAND_LINK_NOTE_MAX}</p>
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
