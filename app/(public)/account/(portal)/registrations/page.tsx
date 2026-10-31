import { formatCents } from "@/modules/payments/format-cents";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CircleAlert, CircleHelp, Inbox, ShieldCheck } from "lucide-react";
import { AccountRegistrationCard } from "@/components/account-registration-card";
import { AttendeeRegistrationContactForm } from "@/components/attendee-registration-contact-form";
import { AttendeeRegistrationAnswersForm } from "@/components/attendee-registration-answers-form";
import { CancellationRequestPanel } from "@/components/cancellation-request-panel";
import { PublicSquarePayment } from "@/components/public-square-payment";
import { RegistrationActionDisclosure } from "@/components/registration-action-disclosure";
import { getRegistrantRequestViewById } from "@/modules/cancellation-requests/repository";
import type { RegistrantRequestView } from "@/modules/cancellation-requests/views";
import { registrationViewLink } from "@/modules/attendee-accounts/registration-card";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { requireAttendeeSignInStep } from "@/modules/attendee-accounts/portal-second-step";
import {
  parseHistoryFilter,
  registrationActions,
  splitRegistrationHistory,
  type HistoryFilter,
} from "@/modules/attendee-accounts/registration-history";
import {
  listRegistrationsForVerifiedEmail,
  type AttendeeRegistrationSummary,
} from "@/modules/attendee-accounts/registrations-repository";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My registrations",
  description: "Every IMSDA event registration made with your email address.",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The request panel for one of the signed-in attendee's own registrations. Only a signed-in attendee (not a staff user
 * looking at the portal) can ask; a failure here leaves the rest of the card alone.
 */
async function cancellationFor(registration: AttendeeRegistrationSummary, editable: boolean): Promise<RegistrantRequestView | null> {
  if (!editable) return null;
  const view = await getRegistrantRequestViewById(registration.id).catch(() => null);
  return view && (view.available || view.requests.length > 0) ? view : null;
}

/**
 * The contextual secondary actions of one card (#1176). View registration, the clear default, is on the card itself.
 * Each action here is the existing service's own panel, shown only where `registrationActions` says it is allowed.
 */
function CardActions({
  registration,
  editable,
  cancellation,
  headingLevel,
}: {
  registration: AttendeeRegistrationSummary;
  editable: boolean;
  cancellation: RegistrantRequestView | null;
  headingLevel: 4 | 5;
}) {
  const actions = registrationActions(registration, { editable, cancellation });
  const requestCount = cancellation?.requests.length ?? 0;
  const hasAny = actions.continuePayment || actions.editContact || actions.cancellation || actions.details;
  if (!hasAny) {
    if (!actions.readOnlyHistory) return null;
    return (
      <p className="attendee-reg-readonly">
        {registrationViewLink(registration)
          ? "This record is read-only history. Open it to see its details."
          : "This registration is kept as read-only history."}
      </p>
    );
  }
  return (
    <div className="attendee-reg-actions" role="group" aria-label={`More for ${registration.event.name}`}>
      {actions.continuePayment && (
        <RegistrationActionDisclosure eventName={registration.event.name} label="Continue payment" hint={`${formatCents(registration.balanceCents)} remaining`}>
          <PublicSquarePayment manageEndpoint={`/api/attendee/registrations/${encodeURIComponent(registration.id)}`} />
        </RegistrationActionDisclosure>
      )}
      {actions.editContact && (
        <RegistrationActionDisclosure eventName={registration.event.name} label="Update contact details">
          <AttendeeRegistrationContactForm registrationId={registration.id} initialContact={registration.contact} />
        </RegistrationActionDisclosure>
      )}
      {actions.details && (
        <RegistrationActionDisclosure eventName={registration.event.name} label="Registration details">
          <AttendeeRegistrationAnswersForm
            registrationId={registration.id}
            description={registration.answerEditing.reason}
            readOnly={!editable || !registration.answerEditing.enabled || actions.readOnlyHistory}
            initialExpectedUpdatedAt={registration.answerEditing.expectedUpdatedAt}
            fields={registration.answerEditing.fields}
            initialAttendees={registration.answerEditing.attendees}
          />
        </RegistrationActionDisclosure>
      )}
      {cancellation && actions.cancellation && (
        <RegistrationActionDisclosure
          eventName={registration.event.name}
          label={actions.cancellation === "request" ? "Request cancellation" : "Cancellation requests"}
          hint={requestCount > 0 ? (requestCount === 1 ? "1 request" : `${requestCount} requests`) : undefined}
        >
          <CancellationRequestPanel
            endpoint={`/api/attendee/registrations/${encodeURIComponent(registration.id)}/cancellation`}
            headingLevel={headingLevel}
            initialView={cancellation}
          />
        </RegistrationActionDisclosure>
      )}
    </div>
  );
}

const filterLabels: Record<HistoryFilter, string> = {
  all: "All",
  upcoming: "Upcoming",
  past: "Past",
  cancelled: "Cancelled",
};

const filterEmptyTitle: Record<Exclude<HistoryFilter, "all">, string> = {
  upcoming: "Nothing upcoming",
  past: "No past registrations",
  cancelled: "No cancelled registrations",
};

export default async function AttendeeRegistrationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ show?: string | string[] }>;
} = {}) {
  await requireAttendeeSignInStep();
  const { account, via } = await getCurrentAttendee();
  if (!account) redirect("/account/sign-in");
  const filter = parseHistoryFilter((await searchParams)?.show);
  const editable = via === "attendee";

  // A failed load is its own calm state with a retry, not "no registrations" and not a blank page.
  const loaded = await listRegistrationsForVerifiedEmail(account.verifiedEmail).then(
    (registrations) => ({ ok: true as const, registrations }),
    (error: unknown) => {
      logError("My registrations failed to load", error, { accountId: account.id });
      return { ok: false as const, registrations: [] as AttendeeRegistrationSummary[] };
    },
  );
  const registrations = loaded.registrations;
  const cancellations = new Map(
    await Promise.all(registrations.map(async (registration) => [registration.id, await cancellationFor(registration, editable)] as const)),
  );

  const { upcoming, past, cancelled } = splitRegistrationHistory(registrations);
  const counts: Record<HistoryFilter, number> = {
    all: upcoming.length + past.length + cancelled.length,
    upcoming: upcoming.length,
    past: past.length,
    cancelled: cancelled.length,
  };
  const showUpcoming = filter === "all" || filter === "upcoming";
  const showHistory = filter !== "upcoming";
  const shownPast = filter === "all" || filter === "past" ? past : [];
  const shownCancelled = filter === "all" || filter === "cancelled" ? cancelled : [];
  const historyCount = shownPast.length + shownCancelled.length;
  // History opens by itself when it is what was asked for or the only thing there; otherwise it stays folded with its counts showing.
  const historyOpen = filter !== "all" || upcoming.length === 0;
  const noRegistrations = loaded.ok && counts.all === 0;
  const filteredEmpty = loaded.ok && counts.all > 0 && counts[filter] === 0;
  // One filled primary per screen: the first card's View registration, else Find events / Try again in the empty states.
  // Only a card with a View registration link can carry the fill (a waitlisted or cancelled record has no hub page).
  const firstCardId = [...(showUpcoming ? upcoming : []), ...(historyOpen ? [...shownPast, ...shownCancelled] : [])].find((registration) => registrationViewLink(registration))?.id;

  const card = (registration: AttendeeRegistrationSummary, level: 3 | 4) => (
    <AccountRegistrationCard
      key={registration.id}
      registration={registration}
      primary={registration.id === firstCardId}
      headingLevel={level}
      showPeople
    >
      <CardActions
        registration={registration}
        editable={editable}
        cancellation={cancellations.get(registration.id) ?? null}
        headingLevel={level === 3 ? 4 : 5}
      />
    </AccountRegistrationCard>
  );

  return (
    <>
      <section className="public-registration-hero public-manage-hero account-page-hero">
        <div>
          <h1>My registrations</h1>
          <p>
            Everything registered with <strong translate="no">{account.verifiedEmail}</strong>
          </p>
        </div>
      </section>

      <div className="attendee-ov-layout">
        <div className="attendee-ov-main">
          {!loaded.ok ? (
            <div className="attendee-ov-notice" role="alert">
              <CircleAlert size={20} aria-hidden="true" />
              <div>
                <strong>We could not load your registrations</strong>
                <p>Nothing has been changed. Try again in a moment, or ask the event team if it keeps happening.</p>
                <a className="primary-button attendee-ov-retry" href="/account/registrations">Try again</a>
              </div>
            </div>
          ) : noRegistrations ? (
            <section className="attendee-ov-empty" aria-labelledby="attendee-reg-none">
              <Inbox size={22} aria-hidden="true" />
              <div>
                <h2 id="attendee-reg-none">No registrations match this address</h2>
                <p>
                  A registration appears here when its contact email is <span translate="no">{account.verifiedEmail}</span>. If you
                  registered under a different address, the event team can correct the one on file, and doing that is what attaches
                  it to this account.
                </p>
                <p className="attendee-ov-empty-links">
                  <Link className="primary-button" href="/events">Find events</Link>
                  <Link className="empty-state-link" href="/recover-registration">Find a registration made with another email</Link>
                </p>
              </div>
            </section>
          ) : (
            <>
              <nav className="attendee-reg-filters" aria-label="Show registrations">
                <ul>
                  {(Object.keys(filterLabels) as HistoryFilter[]).map((key) => (
                    <li key={key}>
                      <Link
                        aria-current={key === filter ? "true" : undefined}
                        href={key === "all" ? "/account/registrations" : `/account/registrations?show=${key}`}
                      >
                        {filterLabels[key]} <span className="attendee-reg-count">({counts[key]})</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>

              {filteredEmpty && filter !== "all" && (
                <div className="attendee-ov-empty" role="status">
                  <Inbox size={22} aria-hidden="true" />
                  <div>
                    <h2>{filterEmptyTitle[filter]}</h2>
                    <p>None of your {counts.all === 1 ? "1 registration" : `${counts.all} registrations`} fit this view.</p>
                    <p className="attendee-ov-empty-links">
                      <Link className="secondary-button" href="/account/registrations">Show all my registrations</Link>
                    </p>
                  </div>
                </div>
              )}

              {showUpcoming && !filteredEmpty && (
                <section aria-labelledby="attendee-reg-upcoming">
                  <h2 className="attendee-ov-heading" id="attendee-reg-upcoming">
                    Upcoming and active <span className="attendee-reg-count">({upcoming.length})</span>
                  </h2>
                  {upcoming.length > 0 ? (
                    <ul className="attendee-ov-cards">{upcoming.map((registration) => card(registration, 3))}</ul>
                  ) : (
                    <div className="attendee-ov-empty">
                      <Inbox size={22} aria-hidden="true" />
                      <div>
                        <h3>Nothing coming up</h3>
                        <p>Your past and cancelled registrations are listed below.</p>
                        <p className="attendee-ov-empty-links">
                          <Link className="secondary-button" href="/events">Find events</Link>
                        </p>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {showHistory && historyCount > 0 && (
                <section aria-label="Past and cancelled registrations">
                  <details className="attendee-reg-history" open={historyOpen}>
                    <summary>
                      <span className="attendee-reg-history-title">
                        Past and cancelled <span className="attendee-reg-count">({historyCount})</span>
                      </span>
                      <span className="attendee-reg-history-status">
                        {[
                          shownPast.length > 0 ? `${shownPast.length} past` : null,
                          shownCancelled.length > 0 ? `${shownCancelled.length} cancelled` : null,
                        ].filter(Boolean).join(" · ")}
                      </span>
                    </summary>
                    <div className="attendee-reg-history-body">
                      {shownPast.length > 0 && (
                        <section aria-labelledby="attendee-reg-past">
                          <h3 className="attendee-reg-group" id="attendee-reg-past">Past <span className="attendee-reg-count">({shownPast.length})</span></h3>
                          <ul className="attendee-ov-cards">{shownPast.map((registration) => card(registration, 4))}</ul>
                        </section>
                      )}
                      {shownCancelled.length > 0 && (
                        <section aria-labelledby="attendee-reg-cancelled">
                          <h3 className="attendee-reg-group" id="attendee-reg-cancelled">Cancelled <span className="attendee-reg-count">({shownCancelled.length})</span></h3>
                          <ul className="attendee-ov-cards">{shownCancelled.map((registration) => card(registration, 4))}</ul>
                        </section>
                      )}
                    </div>
                  </details>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="attendee-ov-side" aria-label="Account and help">
          {/* Icon then a single block: this card is a flex row, and two loose
            * paragraphs would sit side by side rather than stack. */}
          <section className="public-manage-security-note">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <strong>Why these and no others</strong>
              <p>
                This account reaches every registration whose contact email is your verified
                address, and nothing else. It is never matched on your name.
              </p>
            </div>
          </section>
          <section className="public-manage-card account-overview-card">
            <p className="public-registration-eyebrow"><CircleHelp size={15} aria-hidden="true" /> Help</p>
            <h2>Need to change something?</h2>
            <p className="field-help">
              Contact details can be updated with a fresh emailed code. Changes to attendance, rooms,
              activities, or transfers go through the event team. A cancellation is a request the event
              team reviews; sending one does not cancel or refund anything.
            </p>
            <Link className="secondary-button account-overview-link" href="/recover-registration">
              Find a registration made with another email <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
