import Link from "next/link";
import { ArrowRight, CalendarDays, CircleAlert, FileText, Info, UsersRound } from "lucide-react";
import type { ClubHomeStep } from "@/modules/club-rosters/home-next-task";
import { ClubSetupHelp } from "@/components/role-setup-help";
import {
  yearLabel,
  type ClubHomeEventCardData,
  type ClubHomeRosterPreview,
  type ClubHomeSummaryItem,
  type ClubHomeUsefulLink,
} from "@/modules/club-rosters/home-view";

/**
 * The pieces of the club Home (#1166). Every prop is a projection of the
 * selected, authorized club and club year built in `home-view.ts`; these
 * components decide layout and wording only. There is exactly one filled
 * (primary) button on the page: the first task's action.
 */

/** The short club-oriented heading and the compact year summary. Counts name their unit and source. */
export function ClubHomeSummary({ clubYear, summary }: { clubYear: string; summary: ClubHomeSummaryItem[] }) {
  return (
    <section aria-labelledby="club-home-heading" className="public-manage-card club-home-summary">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">{`Club year ${yearLabel(clubYear)}`}</p>
        <h2 id="club-home-heading">Your club this year</h2>
      </div>
      <dl className="club-home-counts">
        {summary.map((item) => (
          <div className="club-home-count" key={item.key}>
            <dt>{item.label}</dt>
            <dd className="club-home-count-value">{item.value ?? "Unavailable"}</dd>
            <dd className="club-home-count-definition">{item.definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Shown on a read-only past or next year: there are no tasks and no edit actions on Home. */
export function ClubHomeReadOnlyNotice({
  clubYear,
  currentHref,
  currentClubYear,
  contactsEditable = false,
}: {
  clubYear: string;
  currentHref: string;
  currentClubYear: string;
  /** Next year's roster still lets a director or deputy update emergency contacts (#959); the roster says the same. */
  contactsEditable?: boolean;
}) {
  return (
    // Static page content, not a live update, so no status role.
    <p className="inline-notice club-home-readonly">
      <Info size={16} aria-hidden="true" /> Showing {yearLabel(clubYear)} read-only. Tasks and event registrations are for the current year.{" "}
      {contactsEditable && "A director or deputy can still edit emergency contacts on the roster. "}
      <Link href={currentHref}>{`Back to ${yearLabel(currentClubYear)}`}</Link>
    </p>
  );
}

/**
 * Continue club work: only tasks a saved draft, a roster row, a due Monthly
 * Record, an open event or a Sterling Volunteers reminder backs. The first
 * task's action is the page's one filled button.
 */
export function ClubHomeTasks({
  steps,
  deadlines,
  unavailable = [],
  emptyNote,
}: {
  steps: ClubHomeStep[];
  deadlines: Readonly<Record<string, string>>;
  /** Sources that failed to load (for example "Saved club form drafts"): say so instead of implying there is nothing there. */
  unavailable?: string[];
  emptyNote: string;
}) {
  return (
    <section aria-labelledby="club-work-heading" className="public-manage-card club-home-work">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Next steps</p>
        <h2 id="club-work-heading">Continue club work</h2>
      </div>
      {unavailable.length > 0 && (
        <p className="inline-notice" role="status">
          <CircleAlert size={16} aria-hidden="true" /> Could not load: {unavailable.join(", ")}. Their tasks are not listed. Reload the page to try again.
        </p>
      )}
      {steps.length === 0 ? (
        <p className="public-manage-empty"><FileText size={17} aria-hidden="true" /> {emptyNote}</p>
      ) : (
        <ul className="public-manage-club-list club-home-task-list">
          {steps.map((step, index) => (
            <li className={step.danger ? "club-step-danger" : undefined} key={step.key}>
              <CircleAlert size={17} aria-hidden="true" />
              <span>
                {step.danger && <small className="club-step-flag">Sterling Volunteers</small>}
                <strong>{step.text}</strong>
                {step.detail && <small>{step.detail}</small>}
                {deadlines[step.key] && <small className="club-home-deadline">{deadlines[step.key]}</small>}
              </span>
              <Link className={`${index === 0 ? "primary-button" : "secondary-button"} club-event-action`} href={step.href}>
                {step.action}
                {step.actionContext && <span className="sr-only"> {step.actionContext}</span>} <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The conference deadline list failed to load: say so instead of showing "no deadlines". */
export function ClubHomeDeadlinesUnavailable() {
  return (
    <section aria-labelledby="club-home-deadlines-heading" className="public-manage-card">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Conference dates</p>
        <h2 id="club-home-deadlines-heading">Upcoming deadlines</h2>
      </div>
      <p className="inline-notice" role="status"><CircleAlert size={16} aria-hidden="true" /> Deadlines could not be loaded. Reload the page to try again.</p>
    </section>
  );
}

/** A few people with a role or type and an age, never a birth date. The link is the roster's own page. */
export function ClubHomeRoster({
  preview,
  rosterHref,
  readOnly,
  clubYear,
  unavailable = false,
  setupBase,
}: {
  unavailable?: boolean;
  /** The club's portal path. Given for the director's own Home, so an empty roster says how to fill it (#1435). */
  setupBase?: string;
  preview: ClubHomeRosterPreview;
  rosterHref: string;
  readOnly: boolean;
  clubYear: string;
}) {
  return (
    <section aria-labelledby="club-home-roster-heading" className="public-manage-card club-home-roster">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">{`${yearLabel(clubYear)} roster`}</p>
        <h2 id="club-home-roster-heading">Roster</h2>
      </div>
      {unavailable ? (
        <p className="inline-notice" role="status"><CircleAlert size={16} aria-hidden="true" /> The roster could not be loaded. Reload the page to try again.</p>
      ) : preview.rows.length === 0 ? (
        <>
          <p className="public-manage-empty"><UsersRound size={17} aria-hidden="true" /> {readOnly ? "No one was on this club's roster that year." : "No one is on this year's roster yet."}</p>
          {!readOnly && setupBase && <ClubSetupHelp base={setupBase} context="the roster" id="roster-empty" />}
        </>
      ) : (
        <>
          <ul className="club-home-roster-list">
            {preview.rows.map((row) => (
              <li key={row.id}>
                <strong translate="no">{row.name}</strong>
                <span>{row.detail}</span>
                <span>{row.age}</span>
              </li>
            ))}
          </ul>
          <p className="field-help">
            Showing {preview.rows.length} of {preview.total} active {preview.total === 1 ? "person" : "people"}.
          </p>
        </>
      )}
      <Link className="secondary-button club-event-action club-home-link" href={rosterHref}>
        {readOnly ? "View roster" : preview.rows.length === 0 ? "Open roster to add people" : "Open roster"} <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </section>
  );
}

/** The club's event registrations, each billed the way the event is billed. Never a payment action. */
export function ClubHomeEvents({
  cards,
  hasOpenEvents,
  eventsHref,
  unavailable = false,
  setupBase,
}: {
  unavailable?: boolean;
  /** The club's portal path. Given for the director's own Home (#1435). */
  setupBase?: string;
  cards: ClubHomeEventCardData[];
  hasOpenEvents: boolean;
  eventsHref: string;
}) {
  return (
    <section aria-labelledby="club-home-event-heading" className="public-manage-card club-home-events">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Club event</p>
        <h2 id="club-home-event-heading">{cards.length > 1 ? "Club events" : "Club event"}</h2>
      </div>
      {unavailable ? (
        <p className="inline-notice" role="status"><CircleAlert size={16} aria-hidden="true" /> Club events could not be loaded. Reload the page to try again.</p>
      ) : cards.length === 0 ? (
        <>
          <p className="public-manage-empty">
            <CalendarDays size={17} aria-hidden="true" />{" "}
            {hasOpenEvents ? "Your club has not registered for a club event yet." : "No club events are open for your club right now."}
          </p>
          {setupBase && <ClubSetupHelp base={setupBase} context="club events" id={hasOpenEvents ? "events-none-registered" : "events-none-published"} />}
          <Link className="secondary-button club-event-action club-home-link" href={eventsHref}>
            Open club events <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </>
      ) : (
        <ul className="club-home-event-list">
          {cards.map((card) => (
            <li className="club-home-event" key={card.id}>
              <h3 translate="no">{card.name}</h3>
              <dl>
                <div><dt>Date</dt><dd>{card.dateLabel}</dd></div>
                <div><dt>People</dt><dd>{card.people}</dd></div>
                <div><dt>Registration</dt><dd>{card.lifecycle}</dd></div>
                <div><dt>Billing</dt><dd>{card.billing}</dd></div>
              </dl>
              <Link className="secondary-button club-event-action club-home-link" href={card.href}>
                View club registration<span className="sr-only">{` for ${card.name}`}</span> <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="home-more"><Link className="home-events-link" href="/events">See all events open for registration</Link></p>
    </section>
  );
}

/** Contextual links the viewer's role already has in the club navigation. */
export function ClubHomeUsefulLinks({ links }: { links: ClubHomeUsefulLink[] }) {
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="club-home-useful-heading" className="public-manage-card club-home-useful">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Shortcuts</p>
        <h2 id="club-home-useful-heading">Useful this month</h2>
      </div>
      <ul className="club-home-useful-list">
        {links.map((link) => (
          <li key={link.key}>
            <Link href={link.href}>{link.label}</Link>
            <span>{link.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
