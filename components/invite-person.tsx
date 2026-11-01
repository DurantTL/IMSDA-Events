"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { UserPlus, X } from "lucide-react";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary } from "@/components/form-error-summary";
import { CopyApplicationLink } from "@/components/copy-application-link";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { RoleDetails } from "@/components/role-details";
import { systemRoleText } from "@/modules/access/role-descriptions";
import { eventRoles, type EventRole } from "@/modules/access/permissions";
import { roleLabel } from "@/modules/access/role-display";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import styles from "./people-directory.module.css";
import { isLooseEmail } from "@/lib/field-validation";

const FIELD_LABELS = { name: "Name", email: "Email", access: "Access to give", events: "Events", clubs: "Clubs" } as const;

type Option = { id: string; name: string };
type EventRow = { key: number; eventId: string; role: EventRole };
type ClubRow = { key: number; organizationId: string; role: ClubRole };
type FieldErrors = Partial<Record<"name" | "email" | "access", string>> & { events?: string; clubs?: string };

type InviteResult = {
  created: {
    staffLogin: boolean;
    invitationEmailed: boolean;
    setupUrl?: string;
    setupExpiresAt?: string;
    clubInviteIds: string[];
    areaCoordinatorInviteId?: string;
    signUpUrl?: string;
  };
  deferred: { personHref: string } | null;
  staffError?: string;
};

const clubRoles = Object.keys(clubDirectorRoleLabels) as ClubRole[];

/**
 * The one Invite a person button (#1276). Name, email and the access to give; the server decides which kind of invite
 * each piece needs. A Clubs Administrator is only offered Area Coordinator and club roles (the server refuses the rest).
 */
export function InvitePerson({ scope, eventOptions, clubOptions }: {
  scope: "full" | "clubs";
  eventOptions: readonly Option[];
  clubOptions: readonly Option[];
}) {
  const router = useRouter();
  const full = scope === "full";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [systemAdmin, setSystemAdmin] = useState(false);
  const [clubsAdministrator, setClubsAdministrator] = useState(false);
  const [areaCoordinator, setAreaCoordinator] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState("");
  const [result, setResult] = useState<InviteResult | null>(null);
  const titleId = useId();
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();

  function close() {
    if (busy) return;
    setOpen(false);
    // Whatever was created shows in the Pending invites list.
    if (result) router.refresh();
  }
  const dialogRef = useAccessibleDialog<HTMLElement>(open, close);

  function show() {
    setName(""); setEmail(""); setSystemAdmin(false); setClubsAdministrator(false); setAreaCoordinator(false);
    setEvents([]); setClubs([]); setErrors({}); setFailure(""); setResult(null); clearSummary();
    setOpen(true);
  }

  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (name.trim().length < 2) found.name = "Enter the person's name.";
    if (!isLooseEmail(email.trim())) found.email = "Enter a valid email address.";
    if (events.some((row) => !row.eventId)) found.events = "Choose an event for each event row, or remove the row.";
    else if (new Set(events.map((row) => row.eventId)).size !== events.length) found.events = "Each event can be chosen once.";
    if (clubs.some((row) => !row.organizationId)) found.clubs = "Choose a club for each club row, or remove the row.";
    else if (new Set(clubs.map((row) => `${row.organizationId}:${row.role}`)).size !== clubs.length) found.clubs = "Each club role can be chosen once.";
    if (!systemAdmin && !clubsAdministrator && !areaCoordinator && events.length === 0 && clubs.length === 0) found.access = "Choose at least one kind of access.";
    return found;
  }

  /** A changed field (or one inside an access group) drops its own message and summary item. */
  function fieldChanged(event: FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    const id = target.closest<HTMLElement>("fieldset[id^='invite-']")?.id ?? target.id;
    const key = id.replace(/^invite-/, "") as keyof FieldErrors;
    if (!id.startsWith("invite-")) return;
    clearSummaryField(id);
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure("");
    const found = validate();
    setErrors(found);
    const problems = (["name", "email", "access", "events", "clubs"] as const).filter((key) => found[key]);
    if (problems.length > 0) {
      showSummary(problems.map((key) => ({ targetId: `invite-${key}`, message: summaryMessage(FIELD_LABELS[key], found[key] as string) })));
      return;
    }
    clearSummary();
    setBusy(true);
    try {
      const response = await fetch("/api/admin/people/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          access: {
            systemAdmin, clubsAdministrator, areaCoordinator,
            events: events.map(({ eventId, role }) => ({ eventId, role })),
            clubs: clubs.map(({ organizationId, role }) => ({ organizationId, role })),
          },
        }),
      });
      const body = await response.json().catch(() => ({})) as Partial<InviteResult> & { message?: string; issues?: Array<{ message?: string; path?: Array<string | number> }> };
      if (!response.ok) {
        const issue = body.issues?.[0];
        const field = issue?.path?.[0];
        // A server problem with a field goes through the summary like a client one: focus and announcement.
        const serverProblem: { key: "name" | "email" | "access"; message: string } | null = field === "name" || field === "email"
          ? { key: field, message: issue?.message ?? "Check this field." }
          : field === "access" ? { key: field, message: issue?.message ?? "Check the access you chose." } : null;
        if (serverProblem) {
          setErrors({ [serverProblem.key]: serverProblem.message });
          showSummary([{ targetId: `invite-${serverProblem.key}`, message: summaryMessage(FIELD_LABELS[serverProblem.key], serverProblem.message) }]);
        } else setFailure(body.message ?? "The invite could not be sent.");
        return;
      }
      const done = body as InviteResult;
      const createdSomething = done.staffError !== undefined || done.created.staffLogin || done.created.clubInviteIds.length > 0 || Boolean(done.created.areaCoordinatorInviteId);
      if (!createdSomething && done.deferred) {
        // Nothing to create: the person already has an account, so go straight to their page to save the access.
        setOpen(false);
        router.push(done.deferred.personHref);
        return;
      }
      setResult(done);
    } catch {
      setFailure("The invite could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const who = name.trim() || "the person";
  return (
    <>
      <button aria-haspopup="dialog" className="primary-button" onClick={show} type="button">
        <UserPlus aria-hidden="true" size={16} /> Invite a person
      </button>
      {open ? (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} role="presentation">
          <section aria-labelledby={titleId} aria-modal="true" className="modal-card" ref={dialogRef} role="dialog" tabIndex={-1}>
            <div className="modal-head">
              <h2 id={titleId}>Invite a person</h2>
              <button aria-label="Close" className="icon-button modal-close-button" disabled={busy} onClick={close} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {result ? (
              <div className={styles.inviteResult}>
                <InviteOutcome name={who} result={result} />
                <div className="form-actions">
                  <button className="primary-button" onClick={close} type="button">Done</button>
                </div>
              </div>
            ) : (
              <form className={styles.inviteForm} noValidate onChange={fieldChanged} onSubmit={(event) => void submit(event)}>
                {summaryItems.length > 0 && <FormErrorSummary items={summaryItems} ref={summaryRef} />}
                <label className={styles.field}>
                  <span>Name</span>
                  <input {...fieldErrorProps("invite-name-error", errors.name)} autoComplete="off" id="invite-name" maxLength={100} onChange={(event) => setName(event.target.value)} value={name} />
                  <FieldError id="invite-name-error">{errors.name}</FieldError>
                </label>
                <label className={styles.field}>
                  <span>Email</span>
                  <input {...fieldErrorProps("invite-email-error", errors.email)} autoComplete="off" id="invite-email" inputMode="email" maxLength={254} onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
                  <FieldError id="invite-email-error">{errors.email}</FieldError>
                </label>

                <fieldset {...fieldErrorProps("invite-access-error", errors.access)} id="invite-access">
                  <legend>Access to give</legend>
                  {full ? (
                    <>
                      <label className={styles.check}>
                        <input checked={systemAdmin} onChange={(event) => setSystemAdmin(event.target.checked)} type="checkbox" />
                        <span>{systemRoleText.SYSTEM_ADMIN.name}<small>{systemRoleText.SYSTEM_ADMIN.summary}</small></span>
                      </label>
                      <RoleDetails role={systemRoleText.SYSTEM_ADMIN} />
                      <label className={styles.check}>
                        <input checked={clubsAdministrator} onChange={(event) => setClubsAdministrator(event.target.checked)} type="checkbox" />
                        <span>{systemRoleText.CLUBS_ADMIN.name}<small>{systemRoleText.CLUBS_ADMIN.summary}</small></span>
                      </label>
                      <RoleDetails role={systemRoleText.CLUBS_ADMIN} />
                    </>
                  ) : null}
                  <label className={styles.check}>
                    <input checked={areaCoordinator} onChange={(event) => setAreaCoordinator(event.target.checked)} type="checkbox" />
                    <span>{systemRoleText.AREA_COORDINATOR.name}<small>{systemRoleText.AREA_COORDINATOR.summary}</small></span>
                  </label>
                  <RoleDetails role={systemRoleText.AREA_COORDINATOR} />
                  <FieldError id="invite-access-error">{errors.access}</FieldError>
                </fieldset>

                {full ? (
                  <fieldset {...fieldErrorProps("invite-events-error", errors.events)} id="invite-events">
                    <legend>Events</legend>
                    {events.map((row, index) => (
                      <div className={styles.rowPair} key={row.key}>
                        <label className={styles.field}>
                          <span>Event {index + 1}</span>
                          <select onChange={(event) => setEvents(events.map((entry) => entry.key === row.key ? { ...entry, eventId: event.target.value } : entry))} value={row.eventId}>
                            <option value="">Choose an event</option>
                            {eventOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                          </select>
                        </label>
                        <label className={styles.field}>
                          <span>Role in event {index + 1}</span>
                          <select onChange={(event) => setEvents(events.map((entry) => entry.key === row.key ? { ...entry, role: event.target.value as EventRole } : entry))} value={row.role}>
                            {eventRoles.map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}
                          </select>
                        </label>
                        <button aria-label={`Remove event ${index + 1}`} className="secondary-button" onClick={() => setEvents(events.filter((entry) => entry.key !== row.key))} type="button">Remove</button>
                      </div>
                    ))}
                    <FieldError id="invite-events-error">{errors.events}</FieldError>
                    <div>
                      <button className="secondary-button" onClick={() => { setEvents([...events, { key: nextKey, eventId: "", role: "READ_ONLY_STAFF" }]); setNextKey(nextKey + 1); }} type="button">Add an event</button>
                    </div>
                  </fieldset>
                ) : null}

                <fieldset {...fieldErrorProps("invite-clubs-error", errors.clubs)} id="invite-clubs">
                  <legend>Clubs</legend>
                  {clubs.map((row, index) => (
                    <div className={styles.rowPair} key={row.key}>
                      <label className={styles.field}>
                        <span>Club {index + 1}</span>
                        <select onChange={(event) => setClubs(clubs.map((entry) => entry.key === row.key ? { ...entry, organizationId: event.target.value } : entry))} value={row.organizationId}>
                          <option value="">Choose a club</option>
                          {clubOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span>Role at club {index + 1}</span>
                        <select onChange={(event) => setClubs(clubs.map((entry) => entry.key === row.key ? { ...entry, role: event.target.value as ClubRole } : entry))} value={row.role}>
                          {clubRoles.map((value) => <option key={value} value={value}>{clubDirectorRoleLabels[value]}</option>)}
                        </select>
                      </label>
                      <button aria-label={`Remove club ${index + 1}`} className="secondary-button" onClick={() => setClubs(clubs.filter((entry) => entry.key !== row.key))} type="button">Remove</button>
                    </div>
                  ))}
                  <FieldError id="invite-clubs-error">{errors.clubs}</FieldError>
                  <div>
                    <button className="secondary-button" onClick={() => { setClubs([...clubs, { key: nextKey, organizationId: "", role: "DIRECTOR" }]); setNextKey(nextKey + 1); }} type="button">Add a club</button>
                  </div>
                </fieldset>

                {failure ? <p className={styles.fieldError} role="alert">{failure}</p> : null}
                <div className="form-actions">
                  <button className="secondary-button" disabled={busy} onClick={close} type="button">Cancel</button>
                  <button className="primary-button" disabled={busy} type="submit">{busy ? "Sending…" : "Send invite"}</button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

/** What the server did, in words, with the links staff hand over when account email isn't set up. */
function InviteOutcome({ name, result }: { name: string; result: InviteResult }) {
  const { created, deferred } = result;
  return (
    <div aria-live="polite" className={styles.inviteResult}>
      {created.staffLogin ? (
        created.invitationEmailed
          ? <p>A staff login was created for {name} and an email with a link to set a password was sent. The link works for 7 days.</p>
          : created.setupUrl
            ? (
              <>
                <p>A staff login was created for {name}. Account email isn&apos;t set up on this server, so give {name} this one-time link to set a password
                  {created.setupExpiresAt ? ` (it expires ${formatInConferenceTime(created.setupExpiresAt)})` : ""}.</p>
                <CopyApplicationLink label="Copy setup link" noun="setup link" url={created.setupUrl} />
              </>
            )
            : <p>A staff login was created for {name}, but the activation link could not be sent. Resend it from Pending invites.</p>
      ) : null}
      {created.clubInviteIds.length > 0 ? (
        <p>{created.clubInviteIds.length === 1 ? "A club invite was" : `${created.clubInviteIds.length} club invites were`} {created.signUpUrl ? "created" : "emailed"} for {name}. They accept it from their account page.</p>
      ) : null}
      {created.areaCoordinatorInviteId ? <p>An Area Coordinator invite was {created.signUpUrl ? "created" : "emailed"} for {name}. They accept it from their account page.</p> : null}
      {created.signUpUrl ? (
        <>
          <p>Account email isn&apos;t set up on this server, so nothing was emailed. Give {name} this sign-up link; the invite is waiting for them under their email address.</p>
          <CopyApplicationLink label="Copy sign-up link" noun="sign-up link" url={created.signUpUrl} />
        </>
      ) : null}
      {result.staffError ? <p className={styles.fieldError} role="alert">{result.staffError}</p> : null}
      {deferred ? (
        <p>
          {name} already has an account for part of this, so that access wasn&apos;t invited.{" "}
          <Link href={deferred.personHref}>Open {name}&apos;s page to save the rest</Link>
        </p>
      ) : null}
    </div>
  );
}
