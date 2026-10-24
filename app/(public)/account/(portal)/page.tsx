import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowRight, CircleAlert, CircleDollarSign, CircleHelp, GraduationCap, Inbox, ShieldAlert, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { AccountRegistrationCard } from "@/components/account-registration-card";
import { AreaCoordinatorCardSection, AreaCoordinatorCardSkeleton } from "@/components/area-coordinator-card";
import { ClubInviteAccept } from "@/components/club-invite-accept";
import { InstructorInviteAccept } from "@/components/instructor-invite-accept";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { requireAttendeeSecondStep } from "@/modules/attendee-accounts/portal-second-step";
import { getAttendeeMfaStatus } from "@/modules/attendee-accounts/mfa-service";
import { accountAmountDue, upcomingRegistrations } from "@/modules/attendee-accounts/account-overview";
import { listRegistrationsForVerifiedEmail } from "@/modules/attendee-accounts/registrations-repository";
import { listInvitesForAccount } from "@/modules/club-imports/invites";
import { accountIsInstructor, listInstructorInvitesForAccount } from "@/modules/honors/instructor-repository";
import { currentAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { clubDirectorRoleLabels } from "@/modules/organizations/director-grants-domain";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false, nocache: true },
};

const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** An email address with a break opportunity before "@" and each ".", so a long one wraps at a natural place. */
function emailWithBreaks(email: string) {
  return email.split(/(?=[@.])/).map((part, index) => (index === 0 ? part : <span key={index}><wbr />{part}</span>));
}

/**
 * The account's front page (#1175): a personal greeting, the registrations coming up with one next action each, and a
 * secondary column for the account and help. Everything it shows comes from the existing verified-email match and the
 * existing grants; it adds no new authority.
 */
export default async function AttendeeAccountOverviewPage() {
  await requireAttendeeSecondStep();
  const { account, via } = await getCurrentAttendee();
  if (!account) redirect("/account/sign-in");

  const [registrationsResult, mfaStatus, clubs, invites, areaCoordinator, instructorInvites, isInstructor] = await Promise.all([
    // A failed load is its own calm state with a retry: not "no registrations", and not a blank page.
    listRegistrationsForVerifiedEmail(account.verifiedEmail).then(
      (registrations) => ({ ok: true as const, registrations }),
      (error: unknown) => {
        logError("Account overview registrations failed to load", error, { accountId: account.id });
        return { ok: false as const, registrations: [] };
      },
    ),
    getAttendeeMfaStatus(account.id),
    listDirectedClubs(account.id),
    // Only the person themselves may accept, so staff viewing an account don't see them.
    via === "attendee" ? listInvitesForAccount(account.verifiedEmail) : Promise.resolve([]),
    // Null unless this is the person's own session with an active Area Coordinator grant and second step (#656).
    currentAreaCoordinator(),
    // Honors Weekend instructor invites (#833): like club invites, only the person themselves may accept.
    via === "attendee" ? listInstructorInvitesForAccount(account.verifiedEmail) : Promise.resolve([]),
    via === "attendee" ? accountIsInstructor(account.id) : Promise.resolve(false),
  ]);
  const registrations = registrationsResult.registrations;
  const upcoming = upcomingRegistrations(registrations);
  const amountDue = accountAmountDue(registrations);
  const authenticatorOn = mfaStatus.status === "ACTIVE";
  const hasWorkspaceCards = Boolean(areaCoordinator) || clubs.length > 0 || isInstructor;
  // Exactly one filled primary per screen, in this order: an invite's Accept (when one is showing), else the first
  // card's View registration, else Find events in the empty states, else (registrations failed to load) a club
  // director's authenticator prompt. The prompt's wording never changes; only its fill does.
  const inviteShowing = invites.length > 0 || instructorInvites.length > 0;
  const needsAuthenticator = !authenticatorOn && clubs.length > 0;
  const cardPrimary = !inviteShowing && upcoming.length > 0;
  const findEventsPrimary = !inviteShowing && registrationsResult.ok && upcoming.length === 0;
  const authenticatorPrimary = needsAuthenticator && !inviteShowing && !registrationsResult.ok;
  // Payable balances count registrations that may have no card here (an ended event still owed): then the line says
  // so and links to the full list, so it never reads as belonging to the cards above it.
  const uncardedDue = registrations.some(
    (registration) => registration.payment.paymentEligible && registration.balanceCents > 0 && !upcoming.includes(registration),
  );
  const dueAmount = <span translate="no">{moneyFormatter.format(amountDue.totalCents / 100)}</span>;
  const dueLine = amountDue.totalCents > 0 && (
    <p className="account-overview-alert attendee-ov-due">
      <CircleDollarSign size={16} aria-hidden="true" />{" "}
      {uncardedDue
        ? <span>{dueAmount} still due {amountDue.scope}, including past registrations. <Link className="empty-state-link" href="/account/registrations">See my registrations</Link></span>
        : <span>{dueAmount} still due {amountDue.scope}</span>}
    </p>
  );
  const helpSlug = upcoming[0]?.event.slug;

  return (
    <>
      <section className="public-registration-hero public-manage-hero account-page-hero">
        <div>
          <p className="public-registration-eyebrow">Your account</p>
          <h1>Hello, <span translate="no">{account.displayName}</span></h1>
          <p>Here are your event plans and anything you need to finish.</p>
        </div>
      </section>

      {invites.length > 0 && <ClubInviteAccept invites={invites} />}
      {instructorInvites.length > 0 && <InstructorInviteAccept invites={instructorInvites} />}

      <div className="attendee-ov-layout">
        <div className="attendee-ov-main">
          <section aria-labelledby="attendee-ov-upcoming">
            <h2 className="attendee-ov-heading" id="attendee-ov-upcoming">Coming up for you</h2>
            {!registrationsResult.ok ? (
              <div className="attendee-ov-notice" role="alert">
                <CircleAlert size={20} aria-hidden="true" />
                <div>
                  <strong>We could not load your registrations</strong>
                  <p>Nothing has been changed. Try again in a moment, or ask the event team if it keeps happening.</p>
                  <a className="secondary-button attendee-ov-retry" href="/account">Try again</a>
                </div>
              </div>
            ) : upcoming.length > 0 ? (
              <>
                {dueLine}
                <ul className="attendee-ov-cards">
                  {upcoming.map((registration, index) => (
                    <AccountRegistrationCard key={registration.id} registration={registration} primary={cardPrimary && index === 0} />
                  ))}
                </ul>
              </>
            ) : (
              <>
              {dueLine}
              <div className="attendee-ov-empty">
                <Inbox size={22} aria-hidden="true" />
                <div>
                  <h3>{registrations.length === 0 ? "No registrations yet" : "Nothing coming up"}</h3>
                  <p>
                    {registrations.length === 0
                      ? <>Registrations made with <span translate="no">{emailWithBreaks(account.verifiedEmail)}</span> show up here.</>
                      : "Your past and cancelled registrations are still listed under My registrations."}
                  </p>
                  <p className="attendee-ov-empty-links">
                    <Link className={findEventsPrimary ? "primary-button" : "secondary-button"} href="/events">Find events</Link>
                    <Link className="empty-state-link" href="/recover-registration">Find a registration made with another email</Link>
                  </p>
                </div>
              </div>
              </>
            )}
            {registrationsResult.ok && registrations.length > 0 && (
              <p className="attendee-ov-all">
                <Link className="text-button" href="/account/registrations">
                  {registrations.length > upcoming.length && upcoming.length > 0
                    ? `All my registrations (${registrations.length}), including past and cancelled`
                    : "All my registrations"}
                  {" "}<ArrowRight size={14} aria-hidden="true" />
                </Link>
              </p>
            )}
          </section>

          {hasWorkspaceCards && (
            <section aria-labelledby="attendee-ov-roles">
              <h2 className="attendee-ov-heading" id="attendee-ov-roles">Your other roles</h2>
              <div className="attendee-ov-roles">
                {areaCoordinator && (
                  <Suspense fallback={<AreaCoordinatorCardSkeleton />}>
                    <AreaCoordinatorCardSection account={areaCoordinator} />
                  </Suspense>
                )}

                {clubs.length > 0 && (
                  <section className="public-manage-card account-overview-card">
                    <p className="public-registration-eyebrow"><UsersRound size={15} aria-hidden="true" /> {clubs.length === 1 ? "My club" : "My clubs"}</p>
                    <ul className="account-overview-list">
                      {clubs.map((club) => (
                        <li key={club.organizationId}>
                          <Link href={`/account/clubs/${club.organizationId}`}>
                            <strong translate="no">{club.name}</strong>
                            <small>{clubDirectorRoleLabels[club.role]}</small>
                            <ArrowRight size={15} aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <p className="field-help">Roster, club event registration, and class choices.</p>
                  </section>
                )}

                {isInstructor && (
                  <section className="public-manage-card account-overview-card">
                    <p className="public-registration-eyebrow"><GraduationCap size={15} aria-hidden="true" /> Honors Weekend</p>
                    <h3>Your classes</h3>
                    <p className="field-help">Class rosters and marking attendance and completion for the classes you teach.</p>
                    <Link className="secondary-button account-overview-link" href="/account/instructor">
                      Open your classes <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </section>
                )}
              </div>
            </section>
          )}
        </div>

        <aside className="attendee-ov-side" aria-label="Account and help">
          <section className="public-manage-card account-overview-card">
            <p className="public-registration-eyebrow">
              {authenticatorOn ? <ShieldCheck size={15} aria-hidden="true" /> : <ShieldAlert size={15} aria-hidden="true" />} Your registration account
            </p>
            <p className="attendee-ov-email" translate="no">{emailWithBreaks(account.verifiedEmail)}</p>
            <p className="field-help">
              Registrations connected to this verified email appear here.{" "}
              {authenticatorOn
                ? "Two-step sign-in is on."
                : clubs.length > 0
                  ? "Club rosters hold young people's birth dates, so they need an authenticator. Set one up to open your club."
                  : "Two-step sign-in is off. Add an authenticator app for extra protection."}
            </p>
            <Link className={`${authenticatorPrimary ? "primary-button" : "secondary-button"} account-overview-link`} href="/account/profile">
              <UserRound size={14} aria-hidden="true" /> {needsAuthenticator ? "Set up an authenticator" : "Profile and security"} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </section>

          <section className="public-manage-card account-overview-card">
            <p className="public-registration-eyebrow"><CircleHelp size={15} aria-hidden="true" /> Help</p>
            <h2>A question about your event?</h2>
            <p className="field-help">
              {helpSlug
                ? "Open a registration to find its event team, arrangements and anything that needs a change."
                : "Registered with a different email, or not sure where your registration is? We can help you find it."}
            </p>
            <Link
              className="secondary-button account-overview-link"
              href={helpSlug ? `/account/events/${encodeURIComponent(helpSlug)}` : "/recover-registration"}
            >
              {helpSlug ? "Get event help" : "Find my registration"} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
