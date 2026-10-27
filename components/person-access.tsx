import type { ReactNode } from "react";
import type { PersonDetail } from "@/modules/system-admin/people-directory";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";
import {
  AccountActions,
  AddClubRole,
  AddToEvent,
  EventMembershipControls,
  RevokeClubRole,
  RoleToggle,
} from "@/components/person-access-controls";
import styles from "./people-directory.module.css";

type Tone = "green" | "gold" | "coral";

function Chip({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`${styles.chip} ${tone ? styles[tone] : styles.kind}`}>{children}</span>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className={styles.fact}>
      <strong>{label}</strong>
      <span className={styles.factValue}>{children}</span>
    </li>
  );
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-US", { timeZone: "UTC" }) : "Never";
}

function OnOff({ on, offLabel = "Off" }: { on: boolean; offLabel?: string }) {
  return on ? <Chip tone="green">On</Chip> : <Chip>{offLabel}</Chip>;
}

/**
 * The person page (#1275): System-wide, Events, Clubs and Account. A control is drawn only when the route behind it
 * would admit the viewer: system administrators get all of them; a Clubs Administrator gets the Area Coordinator and
 * club role controls and a read-only view of the rest, with Events and Account left out. The server still decides.
 */
export function PersonAccess({
  person,
  scope,
  viewerUserId,
  eventOptions,
  clubOptions,
  linkedEmailChangesTogether,
}: {
  person: PersonDetail;
  scope: "full" | "clubs";
  viewerUserId: string;
  eventOptions: ReadonlyArray<{ id: string; name: string }>;
  clubOptions: ReadonlyArray<{ id: string; name: string }>;
  linkedEmailChangesTogether: boolean;
}) {
  const hasStaff = person.staffId !== null;
  const hasAccount = person.accountId !== null;
  const full = scope === "full";
  const isSelf = person.staffId !== null && person.staffId === viewerUserId;
  const name = person.name || person.email;
  const onEventIds = new Set((person.events ?? []).map((event) => event.eventId));
  const addableEvents = eventOptions.filter((event) => !onEventIds.has(event.id));
  return (
    <div className={styles.wrap}>
      <div className={styles.who}>
        <strong translate="no">{person.name || person.email}</strong>
        <span translate="no">{person.email}</span>
        <ul aria-label="Account kinds" className={styles.chips}>
          {hasStaff ? <li className={`${styles.chip} ${styles.kind}`}>Staff login</li> : null}
          {hasAccount ? <li className={`${styles.chip} ${styles.kind}`}>Website account</li> : null}
        </ul>
      </div>

      <section aria-labelledby="people-system-wide" className={styles.box}>
        <h2 id="people-system-wide">System-wide</h2>
        <ul className={styles.facts}>
          <Fact label="System administrator">
            {!hasStaff ? <span className={styles.muted}>Needs a staff login</span>
              : full && !isSelf ? <RoleToggle kind="system-administrator" name={name} on={person.systemAdministrator} userId={person.staffId!} />
                : full && !person.systemAdministrator ? <RoleToggle kind="system-administrator" name={name} on={false} userId={person.staffId!} />
                  : <>
                    <OnOff on={person.systemAdministrator} />
                    {full ? <span className={styles.note}>You can&apos;t remove your own.</span> : null}
                  </>}
          </Fact>
          <Fact label="Clubs Administrator">
            {!hasStaff ? <span className={styles.muted}>Needs a staff login</span>
              : full && !person.systemAdministrator ? <RoleToggle kind="clubs-administrator" name={name} on={person.clubsAdministrator} userId={person.staffId!} />
                : <>
                  <OnOff on={person.clubsAdministrator} />
                  {person.systemAdministrator ? <span className={styles.note}>A system administrator already has every club area.</span> : null}
                </>}
          </Fact>
          <Fact label="Area Coordinator">
            {hasAccount
              ? <RoleToggle accountId={person.accountId!} kind="area-coordinator" name={name} on={person.areaCoordinator} />
              : <span className={styles.muted}>Needs a website account</span>}
          </Fact>
        </ul>
      </section>

      {scope === "full" && person.events ? (
        <section aria-labelledby="people-events" className={styles.box}>
          <h2 id="people-events">Events</h2>
          {!hasStaff ? (
            <p className={styles.lead}>Needs a staff login.</p>
          ) : person.events.length === 0 ? (
            <p className={styles.lead}>Not on any event team.</p>
          ) : (
            <ul className={styles.facts}>
              {person.events.map((event) => (
                <EventMembershipControls key={event.membershipId} membership={event} name={name} targetIsSystemAdministrator={person.systemAdministrator} />
              ))}
            </ul>
          )}
          {hasStaff ? <AddToEvent displayName={person.staff?.displayName ?? name} email={person.staffEmail ?? person.email} events={addableEvents} /> : null}
        </section>
      ) : null}

      <section aria-labelledby="people-clubs" className={styles.box}>
        <h2 id="people-clubs">Clubs</h2>
        {!hasAccount ? (
          <p className={styles.lead}>Needs a website account.</p>
        ) : person.clubs.length === 0 ? (
          <p className={styles.lead}>No club roles.</p>
        ) : (
          <ul className={styles.facts}>
            {person.clubs.map((club) => (
              <Fact key={club.grantId} label={club.clubName}>
                <Chip>{clubDirectorRoleLabels[club.role as ClubRole] ?? club.role}</Chip>
                <Chip tone={club.status === "active" ? "green" : club.status === "scheduled" ? undefined : "coral"}>
                  {club.status === "active" ? "Active"
                    : club.status === "scheduled" ? `Scheduled (starts ${new Date(club.effectiveFrom).toLocaleDateString("en-US", { timeZone: "UTC" })})`
                      : club.status === "ended" ? "Ended" : "Revoked"}
                </Chip>
                {club.status === "active" || club.status === "scheduled" ? (
                  <RevokeClubRole
                    clubName={club.clubName}
                    grantId={club.grantId}
                    name={name}
                    organizationId={club.organizationId}
                    roleName={clubDirectorRoleLabels[club.role as ClubRole] ?? club.role}
                  />
                ) : null}
              </Fact>
            ))}
          </ul>
        )}
        {hasAccount && person.accountEmail ? <AddClubRole accountEmail={person.accountEmail} clubs={clubOptions} name={name} /> : null}
      </section>

      {scope === "full" ? (
        <section aria-labelledby="people-account" className={styles.box}>
          <h2 id="people-account">Account</h2>
          <p className="field-help" style={{ margin: "4px 0 0" }}>
            Reset two-step sign-in when someone loses their phone: their authenticator and passkeys are removed, they&apos;re
            signed out, and they set it up again at their next sign-in. Nobody can turn it off themselves.
          </p>
          <p className="field-help" style={{ margin: "4px 0 0" }}>
            Forgotten passwords are reset by the person with &ldquo;Forgot password&rdquo;. Every action here is recorded.
          </p>
          <ul className={styles.facts}>
            {person.staff ? (
              <>
                <Fact label="Staff login">
                  <Chip tone={person.staff.signInDisabled ? "coral" : person.staff.status === "ACTIVE" ? "green" : "gold"}>
                    {person.staff.signInDisabled ? "Sign-in off" : person.staff.status === "ACTIVE" ? "Active" : "Not activated"}
                  </Chip>
                </Fact>
                <Fact label="Staff two-step sign-in">{person.staff.twoStep}</Fact>
                <Fact label="Staff last sign-in">{when(person.staff.lastSignedInAt)}</Fact>
              </>
            ) : null}
            {person.account ? (
              <>
                <Fact label="Website account">
                  <Chip tone={person.account.signInDisabled ? "coral" : person.account.status === "ACTIVE" ? "green" : "gold"}>
                    {person.account.signInDisabled ? "Sign-in off" : person.account.status === "ACTIVE" ? "Active" : "Not verified"}
                  </Chip>
                </Fact>
                <Fact label="Email verified">{person.account.emailVerified ? "Yes" : "No"}</Fact>
                <Fact label="Website two-step sign-in">{person.account.twoStep}</Fact>
                <Fact label="Website last sign-in">{when(person.account.lastSignedInAt)}</Fact>
              </>
            ) : null}
            <Fact label="Linked">
              {hasStaff && hasAccount ? "Staff login and website account are linked" : hasStaff ? "No website account linked" : "No staff login linked"}
            </Fact>
          </ul>
          <AccountActions
            account={person.account && person.accountId && person.accountEmail
              ? { id: person.accountId, email: person.accountEmail, emailVerified: person.account.emailVerified, twoStepOn: person.account.twoStep === "On" }
              : null}
            isSelf={isSelf}
            linkedEmailChangesTogether={linkedEmailChangesTogether}
            staff={person.staff && person.staffId && person.staffEmail
              ? {
                id: person.staffId,
                email: person.staffEmail,
                displayName: person.staff.displayName,
                jobTitle: person.staff.jobTitle,
                phone: person.staff.phone,
                bio: person.staff.bio,
                signInDisabled: person.staff.signInDisabled,
                twoStepOn: person.staff.twoStep !== "Not set up",
              }
              : null}
          />
        </section>
      ) : null}
    </div>
  );
}
