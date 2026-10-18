"use client";

import { SortOrderNote } from "@/components/list-sort";
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Link2, LogOut, MailCheck, Mail, MapPinned, Search, ShieldOff } from "lucide-react";
import { ActionsMenu } from "@/components/actions-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  HAND_LINK_NOTE_MAX,
  HAND_LINK_REASON_CODES,
  HAND_LINK_REASON_LABELS,
  type HandLinkReasonCode,
} from "@/modules/account-merge/hand-link-reasons";
import { clubDirectorRoleLabels } from "@/modules/organizations/director-grants-domain";
import {
  accountColumnSortKeys,
  accountSortKeys,
  accountSortLabels,
  accountSortOrderText,
  ariaSortFor,
  nextAccountSort,
  type AccountSort,
  type AccountSortKey,
} from "@/modules/system-admin/account-sort";
import type { AttendeeAccountSummary } from "@/modules/system-admin/user-admin";
import { cardCell } from "@/components/table-card-labels";

type PendingAccountAction = {
  account: AttendeeAccountSummary;
  body: Record<string, string | boolean>;
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
};

function when(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" }) : "—";
}

/**
 * Attendee accounts for system administrators (#386): find an account, reset
 * its two-step sign-in after a lost device, sign it out everywhere, or change
 * its email. Passwords are never set here; people use "Forgot password".
 */
export function AttendeeAccountsWorkspace({
  initialAccounts,
  initialQuery = "",
  initialSort = null,
  initialCapped = false,
  linkedEmailChangesTogether = false,
}: {
  /** The one-sign-in switch is on, so a linked account's email change also changes the team sign-in email. */
  linkedEmailChangesTogether?: boolean;
  initialAccounts: AttendeeAccountSummary[];
  initialQuery?: string;
  initialSort?: AccountSort;
  initialCapped?: boolean;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [sort, setSort] = useState<AccountSort>(initialSort);
  const [capped, setCapped] = useState(initialCapped);
  const latestRequest = useRef(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Review before a high-consequence account action (#471): the shared
  // in-page confirm dialog replaces `window.confirm()`, which iOS Safari can
  // silently fail to show at all.
  const [pendingAction, setPendingAction] = useState<PendingAccountAction | null>(null);
  const [dialogError, setDialogError] = useState("");
  // One form dialog for change-email, link and unlink (replaces window.prompt).
  const [form, setForm] = useState<{ kind: "change-email" | "link" | "unlink"; account: AttendeeAccountSummary } | null>(null);
  const [formEmail, setFormEmail] = useState("");
  const [formStaffEmail, setFormStaffEmail] = useState("");
  const [formReason, setFormReason] = useState<HandLinkReasonCode>("DIFFERENT_STAFF_EMAIL");
  const [formNote, setFormNote] = useState("");
  const [formError, setFormError] = useState("");

  // The search and sort stay in the URL together (#738).
  function accountParams(nextQuery: string, nextSort: AccountSort) {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextSort) {
      params.set("sort", nextSort.key);
      params.set("dir", nextSort.direction);
    }
    return params;
  }

  // A submit searches for what is typed; a sort or refresh reuses the last
  // submitted search, not whatever is half-typed in the box (#738).
  async function search(event?: React.FormEvent<HTMLFormElement>, nextSort: AccountSort = sort) {
    event?.preventDefault();
    const effectiveQuery = event ? query : submittedQuery;
    if (event) setSubmittedQuery(query);
    const requestId = ++latestRequest.current;
    setBusy("search");
    setError("");
    try {
      const params = accountParams(effectiveQuery, nextSort);
      const queryString = params.toString();
      window.history.replaceState(null, "", queryString ? `?${queryString}` : window.location.pathname);
      const response = await fetch(`/api/admin/accounts?${queryString}`);
      const result = await response.json().catch(() => ({})) as { accounts?: AttendeeAccountSummary[]; capped?: boolean; message?: string };
      if (requestId !== latestRequest.current) return;
      if (!response.ok || !result.accounts) throw new Error(result.message ?? "Accounts couldn't be loaded.");
      setAccounts(result.accounts);
      setCapped(Boolean(result.capped));
    } catch (caught) {
      if (requestId !== latestRequest.current) return;
      setError(caught instanceof Error ? caught.message : "Accounts couldn't be loaded.");
    } finally {
      if (requestId === latestRequest.current) setBusy("");
    }
  }

  function sortBy(next: NonNullable<AccountSort>) {
    setSort(next);
    void search(undefined, next);
  }

  /** Resolves to `null` on success, or the specific message to show on failure. */
  async function act(account: AttendeeAccountSummary, body: Record<string, unknown>): Promise<string | null> {
    setBusy(account.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(account.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "That account couldn't be updated.");
      setNotice(`${account.displayName || account.email}: ${result.message}`);
      await search();
      return null;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "That account couldn't be updated.";
      setError(message);
      return message;
    } finally {
      setBusy("");
    }
  }

  function openForm(next: { kind: "change-email" | "link" | "unlink"; account: AttendeeAccountSummary }) {
    setFormError("");
    setFormEmail(next.account.email);
    setFormStaffEmail("");
    setFormReason(next.kind === "unlink" ? "WRONG_PERSON_LINKED" : "DIFFERENT_STAFF_EMAIL");
    setFormNote("");
    setForm(next);
  }

  async function confirmForm() {
    if (!form) return;
    setFormError("");
    const reason = { code: formReason, note: formNote.trim() || undefined };
    if (form.kind === "change-email") {
      if (formEmail.trim().toLowerCase() === form.account.email) { setFormError("That is already this account's email."); return; }
    } else if (formReason === "OTHER" && formNote.trim().length < 5) {
      setFormError("Add a note of at least 5 characters for \"Other\".");
      return;
    }
    const failure = await act(
      form.account,
      form.kind === "change-email"
        ? { action: "change-email", email: formEmail }
        : form.kind === "link"
          ? { action: "link-staff", staffEmail: formStaffEmail, reason }
          : { action: "unlink-staff", reason },
    );
    if (failure === null) setForm(null);
    else setFormError(failure);
  }

  function openConfirm(pending: PendingAccountAction) {
    setDialogError("");
    setPendingAction(pending);
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    setDialogError("");
    // The server's own message (e.g. why this account can't be changed),
    // not a generic one, so the dialog explains what actually went wrong.
    const failure = await act(pendingAction.account, pendingAction.body);
    if (failure === null) setPendingAction(null);
    else setDialogError(failure);
  }

  return (
    <section className="page-stack">
      <div className="meta-stack">
        <p className="field-help">
          Reset two-step sign-in when someone loses their phone: their authenticator and passkeys are removed, they&apos;re
          signed out, and club roles set it up again at their next sign-in. Nobody can turn it off themselves.
        </p>
        <p className="field-help">
          Forgotten passwords are reset by the person with &ldquo;Forgot password&rdquo;. Every action here is recorded.
        </p>
      </div>
      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {/* While the confirm dialog is open, its own alert shows the error; one announcement, not two. */}
      {error && !pendingAction && <div className="inline-notice error" role="alert">{error}</div>}
      <form className="panel accounts-search" onSubmit={search}>
        <label>
          <span className="sr-only">Search by email or name</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Search by email or name" type="search" value={query} />
        </label>
        <button className="secondary-button" disabled={busy === "search"} type="submit"><Search aria-hidden="true" size={15} /> Search</button>
      <label className="accounts-sort-field">
          <span>Sort by</span>
          <select
            disabled={busy !== ""}
            onChange={(event) => {
              const key = event.target.value as AccountSortKey | "";
              if (!key) {
                setSort(null);
                void search(undefined, null);
              } else sortBy({ key, direction: sort?.direction ?? "asc" });
            }}
            value={sort?.key ?? ""}
          >
            <option value="">Newest first</option>
            {accountSortKeys.map((key) => <option key={key} value={key}>{accountSortLabels[key]}</option>)}
          </select>
        </label>
        {sort && (
          <button
            aria-label={`Sorted by ${accountSortLabels[sort.key]}, ${sort.direction === "asc" ? "ascending" : "descending"}. Reverse the order.`}
            className="secondary-button accounts-sort-direction"
            disabled={busy !== ""}
            onClick={() => sortBy({ key: sort.key, direction: sort.direction === "asc" ? "desc" : "asc" })}
            type="button"
          >
            {sort.direction === "asc" ? <ArrowUp aria-hidden="true" size={15} /> : <ArrowDown aria-hidden="true" size={15} />}
            {sort.direction === "asc" ? "Ascending" : "Descending"}
          </button>
        )}
      </form>
      <section className="panel">
        <SortOrderNote>{accountSortOrderText(sort)}</SortOrderNote>
        {capped && sort && <p className="inline-notice" role="status">Sorted the newest 5,000 matches — narrow your search.</p>}
        {accounts.length === 0 ? (
          <p className="report-empty">No accounts match.</p>
        ) : (
          <div className="report-table-wrap">
            <table role="table" className="report-table table-cards">
              <thead role="rowgroup">
                <tr role="row">
                  {accountColumnSortKeys.map((key) => (
                    <th aria-sort={ariaSortFor(sort, key)} key={key} role="columnheader" scope="col">
                      <button className="table-sort-button" disabled={busy !== ""} onClick={() => sortBy(nextAccountSort(sort, key))} type="button">
                        {accountSortLabels[key]}
                        {sort?.key === key
                          ? (sort.direction === "asc" ? <ArrowUp aria-hidden="true" size={13} /> : <ArrowDown aria-hidden="true" size={13} />)
                          : <ArrowUpDown aria-hidden="true" size={13} />}
                      </button>
                    </th>
                  ))}
                  <th role="columnheader"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {accounts.map((account) => (
                  <tr role="row" key={account.id}>
                    <td {...cardCell("Account")}>
                      <strong translate="no">{account.displayName || "—"}</strong><br />
                      <small className="break-anywhere" translate="no">{account.email}</small>
                      {account.disabled && <><br /><span className="status-chip coral">Disabled</span></>}
                    </td>
                    <td {...cardCell("Club roles")}>
                      {account.areaCoordinator && <><span className="status-chip green">Area Coordinator</span>{account.clubRoles.length > 0 && <br />}</>}
                      {account.clubRoles.length === 0
                        ? (account.areaCoordinator ? null : "—")
                        : account.clubRoles.map((role) => `${clubDirectorRoleLabels[role.role]}, ${role.clubName}`).join("; ")}
                    </td>
                    <td {...cardCell("Two-step")}>
                      {account.authenticatorOn ? "Authenticator" : ""}
                      {account.authenticatorOn && account.passkeyCount > 0 ? " + " : ""}
                      {account.passkeyCount > 0 ? `${account.passkeyCount} passkey${account.passkeyCount === 1 ? "" : "s"}` : ""}
                      {!account.authenticatorOn && account.passkeyCount === 0 ? "Not set up" : ""}
                    </td>
                    <td {...cardCell("Last sign-in")}>{when(account.lastSignedInAt)}</td>
                    <td {...cardCell(null)}>
                      <div className="row-actions">
                        <ActionsMenu ariaLabel={`Actions for ${account.email}`}>
                          {(account.authenticatorOn || account.passkeyCount > 0) && (
                            <li>
                              <button
                                disabled={busy === account.id}
                                onClick={() => openConfirm({
                                  account,
                                  body: { action: "reset-two-step" },
                                  title: `Reset two-step sign-in for ${account.email}?`,
                                  description: "Their authenticator and passkeys are removed and they're signed out.",
                                  confirmLabel: `Reset two-step for ${account.email}`,
                                  destructive: true,
                                })}
                                type="button"
                              >
                                <ShieldOff aria-hidden="true" size={14} /> Reset two-step
                              </button>
                            </li>
                          )}
                          <li>
                            <button
                              disabled={busy === account.id}
                              onClick={() => openConfirm(account.areaCoordinator
                                ? {
                                  account,
                                  body: { action: "area-coordinator", on: false },
                                  title: `Remove Area Coordinator from ${account.email}?`,
                                  description: "They'll no longer see other clubs.",
                                  confirmLabel: `Remove Area Coordinator from ${account.email}`,
                                  destructive: true,
                                }
                                : {
                                  account,
                                  body: { action: "area-coordinator", on: true },
                                  title: `Make ${account.email} an Area Coordinator?`,
                                  description: "They'll see every club, view only (ages, not birth dates), after a second sign-in step.",
                                  confirmLabel: `Make ${account.email} an Area Coordinator`,
                                  destructive: false,
                                })}
                              type="button"
                            >
                              <MapPinned aria-hidden="true" size={14} /> {account.areaCoordinator ? "Remove Area Coordinator" : "Make Area Coordinator"}
                            </button>
                          </li>
                          <li>
                            <button
                              disabled={busy === account.id}
                              onClick={() => openConfirm({
                                account,
                                body: { action: "sign-out" },
                                title: `Sign ${account.email} out on every device?`,
                                description: "This immediately ends every active session for this account.",
                                confirmLabel: `Sign ${account.email} out everywhere`,
                                destructive: true,
                              })}
                              type="button"
                            >
                              <LogOut aria-hidden="true" size={14} /> Sign out everywhere
                            </button>
                          </li>
                          <li>
                            <button
                              disabled={busy === account.id}
                              onClick={() => openForm({ kind: "change-email", account })}
                              type="button"
                            >
                              <Mail aria-hidden="true" size={14} /> Change email
                            </button>
                          </li>
                          <li>
                            <button
                              disabled={busy === account.id}
                              onClick={() => openForm({ kind: account.linkedToStaff ? "unlink" : "link", account })}
                              type="button"
                            >
                              <Link2 aria-hidden="true" size={14} /> {account.linkedToStaff ? "Unlink team sign-in" : "Link team sign-in"}
                            </button>
                          </li>
                          {!account.emailVerified && (
                            <li>
                              <button
                                disabled={busy === account.id}
                                onClick={() => openConfirm({
                                  account,
                                  body: { action: "send-verification" },
                                  title: `Send a verification email to ${account.email}?`,
                                  description: "A six-digit code is emailed to this account's current address. The email counts as verified only when the person enters it. Nothing is marked verified here.",
                                  confirmLabel: "Send verification email",
                                  destructive: false,
                                })}
                                type="button"
                              >
                                <MailCheck aria-hidden="true" size={14} /> Send verification email
                              </button>
                            </li>
                          )}
                        </ActionsMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        busy={form ? busy === form.account.id : false}
        confirmLabel={form?.kind === "change-email" ? "Change email" : form?.kind === "link" ? "Link sign-ins" : "Unlink sign-ins"}
        destructive={form?.kind === "unlink"}
        error={formError}
        onCancel={() => setForm(null)}
        onConfirm={() => void confirmForm()}
        open={form !== null}
        title={form?.kind === "change-email" ? `Change email for ${form.account.email}` : form?.kind === "link" ? `Link ${form.account.email} to a team sign-in` : form ? `Unlink ${form.account.email} from its team sign-in` : ""}
      >
        {form?.kind === "change-email" && (
          <>
            <p>
              Registrations are found by verified email. The new address starts unverified, the account is signed out
              everywhere, and codes already sent to the old address stop working. Use &ldquo;Send verification email&rdquo; afterwards.
            </p>
            {form.account.linkedToStaff && linkedEmailChangesTogether && (
              <p><strong>This account is linked to a team sign-in, so this also changes the team sign-in email.</strong></p>
            )}
            <label>
              New email
              <input maxLength={254} onChange={(event) => setFormEmail(event.target.value)} type="email" value={formEmail} />
            </label>
          </>
        )}
        {form?.kind === "link" && (
          <>
            <p>
              For a person whose team sign-in uses a different email. Linking gives no staff access: the team account still
              signs in to the staff workspace only with its own password and second step. Either side already linked is refused.
            </p>
            <label>
              Team account email
              <input maxLength={254} onChange={(event) => setFormStaffEmail(event.target.value)} type="email" value={formStaffEmail} />
            </label>
          </>
        )}
        {form?.kind === "unlink" && (
          <p>Unlinking signs the account out everywhere, including attendee sessions opened through the link.</p>
        )}
        {form && form.kind !== "change-email" && (
          <>
            <label>
              Reason
              <select onChange={(event) => setFormReason(event.target.value as HandLinkReasonCode)} value={formReason}>
                {HAND_LINK_REASON_CODES.map((code) => <option key={code} value={code}>{HAND_LINK_REASON_LABELS[code]}</option>)}
              </select>
            </label>
            <label>
              Note {formReason === "OTHER" ? "(required, 5 to" : "(optional, up to"} {HAND_LINK_NOTE_MAX} characters; no personal details)
              <textarea maxLength={HAND_LINK_NOTE_MAX} onChange={(event) => setFormNote(event.target.value)} rows={3} value={formNote} />
            </label>
            <p className="field-help">{formNote.length}/{HAND_LINK_NOTE_MAX}</p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        busy={pendingAction ? busy === pendingAction.account.id : false}
        confirmLabel={pendingAction?.confirmLabel ?? "Confirm"}
        destructive={pendingAction?.destructive ?? false}
        error={dialogError}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void confirmPendingAction()}
        open={pendingAction !== null}
        title={pendingAction?.title ?? ""}
      >
        <p>{pendingAction?.description}</p>
      </ConfirmDialog>
    </section>
  );
}
