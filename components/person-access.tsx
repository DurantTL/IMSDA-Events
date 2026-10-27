import type { ReactNode } from "react";
import type { PersonDetail } from "@/modules/system-admin/people-directory";
import { roleDetails } from "@/modules/access/role-display";
import type { EventRole } from "@/modules/access/permissions";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";
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

/** The person page (#1275 round a): System-wide, Events, Clubs and Account, read only. */
export function PersonAccess({ person, scope }: { person: PersonDetail; scope: "full" | "clubs" }) {
  const hasStaff = person.staffId !== null;
  const hasAccount = person.accountId !== null;
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
            {hasStaff ? <OnOff on={person.systemAdministrator} /> : <span className={styles.muted}>Needs a staff login</span>}
          </Fact>
          <Fact label="Clubs Administrator">
            {hasStaff ? <OnOff on={person.clubsAdministrator} /> : <span className={styles.muted}>Needs a staff login</span>}
          </Fact>
          <Fact label="Area Coordinator">
            {hasAccount ? <OnOff on={person.areaCoordinator} /> : <span className={styles.muted}>Needs a website account</span>}
          </Fact>
        </ul>
      </section>

      {scope === "full" && person.events ? (
        <section aria-labelledby="people-events" className={styles.box}>
          <h2 id="people-events">Events</h2>
          {!hasStaff ? (
            <p className={styles.lead}>Event access needs a staff login.</p>
          ) : person.events.length === 0 ? (
            <p className={styles.lead}>Not on any event team.</p>
          ) : (
            <ul className={styles.facts}>
              {person.events.map((event) => (
                <Fact key={event.membershipId} label={event.eventName}>
                  <Chip>{roleDetails[event.role as EventRole]?.label ?? event.role}</Chip>
                  <Chip tone={event.active ? "green" : "coral"}>{event.active ? "Active" : "Removed"}</Chip>
                  {event.healthInformation ? <Chip>Health information</Chip> : null}
                  {event.finalizeInvoices ? <Chip>Finalize invoices</Chip> : null}
                </Fact>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby="people-clubs" className={styles.box}>
        <h2 id="people-clubs">Clubs</h2>
        {!hasAccount ? (
          <p className={styles.lead}>Club roles need a website account.</p>
        ) : person.clubs.length === 0 ? (
          <p className={styles.lead}>No club roles.</p>
        ) : (
          <ul className={styles.facts}>
            {person.clubs.map((club) => (
              <Fact key={club.grantId} label={club.clubName}>
                <Chip>{clubDirectorRoleLabels[club.role as ClubRole] ?? club.role}</Chip>
                <Chip tone={club.active ? "green" : "coral"}>{club.active ? "Active" : "Revoked"}</Chip>
              </Fact>
            ))}
          </ul>
        )}
      </section>

      {scope === "full" ? (
        <section aria-labelledby="people-account" className={styles.box}>
          <h2 id="people-account">Account</h2>
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
        </section>
      ) : null}
    </div>
  );
}
