"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { UserPlus, X } from "lucide-react";
import { CopyApplicationLink } from "@/components/copy-application-link";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { eventRoles, type EventRole } from "@/modules/access/permissions";
import { roleLabel } from "@/modules/access/role-display";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";
import styles from "./people-directory.module.css";

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

  function close() {
    if (busy) return;
    setOpen(false);
    // Whatever was created shows in the Pending invites list.
    if (result) router.refresh();
  }
  const dialogRef = useAccessibleDialog<HTMLElement>(open, close);

  function show() {
    setName(""); setEmail(""); setSystemAdmin(false); setClubsAdministrator(false); setAreaCoordinator(false);
    setEvents([]); setClubs([]); setErrors({}); setFailure(""); setResult(null);
    setOpen(true);
  }

  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (name.trim().length < 2) found.name = "Enter the person's name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = "Enter a valid email address.";
    if (events.some((row) => !row.eventId)) found.events = "Choose an event for each event row, or remove the row.";
    else if (new Set(events.map((row) => row.eventId)).size !== events.length) found.events = "Each event can be chosen once.";
    if (clubs.some((row) => !row.organizationId)) found.clubs = "Choose a club for each club row, or remove the row.";
    else if (new Set(clubs.map((row) => `${row.organizationId}:${row.role}`)).size !== clubs.length) found.clubs = "Each club role can be chosen once.";
    if (!systemAdmin && !clubsAdministrator && !areaCoordinator && events.length === 0 && clubs.length === 0) found.access = "Choose at least one kind of access.";
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure("");
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
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
        if (field === "name" || field === "email") setErrors({ [field]: issue?.message ?? "Check this field." });
        else if (field === "access") setErrors({ access: issue?.message ?? "Check the access you chose." });
        else setFailure(body.message ?? "The invite could not be sent.");
        return;
      }
      const done = body as InviteResult;
      const createdSomething = done.created.staffLogin || done.created.clubInviteIds.length > 0 || Boolean(done.created.areaCoordinatorInviteId);
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
      <button className="primary-button" onClick={show} type="button">
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
              <form className={styles.inviteForm} noValidate onSubmit={(event) => void submit(event)}>
                <label className={styles.field}>
                  <span>Name</span>
                  <input aria-describedby={errors.name ? "invite-name-error" : undefined} aria-invalid={Boolean(errors.name)} autoComplete="off" maxLength={100} onChange={(event) => setName(event.target.value)} value={name} />
                  {errors.name ? <p className={styles.fieldError} id="invite-name-error" role="alert">{errors.name}</p> : null}
                </label>
                <label className={styles.field}>
                  <span>Email</span>
                  <input aria-describedby={errors.email ? "invite-email-error" : undefined} aria-invalid={Boolean(errors.email)} autoComplete="off" inputMode="email" maxLength={254} onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
                  {errors.email ? <p className={styles.fieldError} id="invite-email-error" role="alert">{errors.email}</p> : null}
                </label>

                <fieldset aria-describedby={errors.access ? "invite-access-error" : undefined}>
                  <legend>Access to give</legend>
                  {full ? (
                    <>
                      <label className={styles.check}>
                        <input checked={systemAdmin} onChange={(event) => setSystemAdmin(event.target.checked)} type="checkbox" />
                        <span>System administrator<small>Administers every event and manages system roles.</small></span>
                      </label>
                      <label className={styles.check}>
                        <input checked={clubsAdministrator} onChange={(event) => setClubsAdministrator(event.target.checked)} type="checkbox" />
                        <span>Clubs Administrator<small>The club areas for every club.</small></span>
                      </label>
                    </>
                  ) : null}
                  <label className={styles.check}>
                    <input checked={areaCoordinator} onChange={(event) => setAreaCoordinator(event.target.checked)} type="checkbox" />
                    <span>Area Coordinator<small>Sees every club, view only.</small></span>
                  </label>
                  {errors.access ? <p className={styles.fieldError} id="invite-access-error" role="alert">{errors.access}</p> : null}
                </fieldset>

                {full ? (
                  <fieldset aria-describedby={errors.events ? "invite-events-error" : undefined}>
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
                    {errors.events ? <p className={styles.fieldError} id="invite-events-error" role="alert">{errors.events}</p> : null}
                    <div>
                      <button className="secondary-button" onClick={() => { setEvents([...events, { key: nextKey, eventId: "", role: "READ_ONLY_STAFF" }]); setNextKey(nextKey + 1); }} type="button">Add an event</button>
                    </div>
                  </fieldset>
                ) : null}

                <fieldset aria-describedby={errors.clubs ? "invite-clubs-error" : undefined}>
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
                  {errors.clubs ? <p className={styles.fieldError} id="invite-clubs-error" role="alert">{errors.clubs}</p> : null}
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
                  {created.setupExpiresAt ? ` (it expires ${new Date(created.setupExpiresAt).toLocaleDateString("en-US", { timeZone: "UTC" })})` : ""}.</p>
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
      {deferred ? (
        <p>
          {name} already has an account for part of this, so that access wasn&apos;t invited.{" "}
          <Link href={deferred.personHref}>Open {name}&apos;s page to save the rest</Link>
        </p>
      ) : null}
    </div>
  );
}
