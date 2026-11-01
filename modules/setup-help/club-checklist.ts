import { monthHasEnded } from "@/modules/club-reports/coordinator-overview-domain";
import { reportableMonths } from "@/modules/club-reports/domain";
import { isClubFormsRole } from "@/modules/club-forms/domain";
import type { ClubCapabilities, ClubRole } from "@/modules/organizations/director-grants-domain";
import { summarizeChecklist, type Checklist, type ChecklistStep } from "./checklist";
import { askDirector, portalGuideHref } from "./role-setup";

/**
 * The club director's "Getting started" checklist (#1435, rule H5). Every step is derived from data the club Home
 * already reads for this viewer; a step the app cannot derive is a `reference` row (a Help guide link, never a fake
 * checkmark). A step the viewer's role cannot open is not linked: it says who to ask (H4). Nothing is stored.
 */
export type ClubChecklistFacts = {
  base: string;
  role: ClubRole;
  capabilities: ClubCapabilities;
  /**
   * The page can prove this viewer's own two-step sign-in is set up: the full club Home is reached only after the
   * second-step check. A reporter's Home and a staff "act as" cannot prove it, so the step is a guide row there, never Done.
   */
  twoStepVerified: boolean;
  /** Active roster members this club year; `null` when the roster could not be read. */
  rosterCount: number | null;
  /** Club event registrations that are not cancelled; `null` when events could not be read. */
  registeredEventCount: number | null;
  hasOpenEvents: boolean;
  /**
   * Months that have ended and are not yet submitted (a draft is not submitted, and a locked unfiled month still counts).
   * `null` when not read (no report access, or a failed read).
   */
  monthsNotSubmitted: number | null;
  /** Sterling Volunteers reminders waiting; `null` when not read. Only worded, never counted as done (honors cannot be derived). */
  sterlingReminders: number | null;
};

const GUIDE = "director-getting-started";

export function buildClubChecklist(facts: ClubChecklistFacts): Checklist {
  const { base, capabilities: can } = facts;
  const steps: ChecklistStep[] = [];
  const add = (step: ChecklistStep) => steps.push(step);

  // Club pages open only after a real second step this session, so a director on this page has done it.
  add({
    id: "two-step",
    label: "Two-step sign-in",
    detail: "Add a passkey (the easiest) or an authenticator app. It protects youth and medical records.",
    done: facts.twoStepVerified,
    reference: !facts.twoStepVerified,
    href: "/account/security",
    linkable: true,
    actionLabel: "Open Security",
    helpHref: portalGuideHref("director-two-step-sign-in"),
  });
  add({
    id: "leaders",
    label: "Leaders and staff",
    detail: "Invite a registrar or reporter, and see who can work in this club.",
    done: false,
    reference: true,
    href: `${base}/club-info#club-team`,
    linkable: can.manageTeam,
    unavailableNote: askDirector("to invite leaders"),
    actionLabel: "Open Club admins",
    helpHref: portalGuideHref("director-leaders-and-invites"),
  });
  add({
    id: "roster",
    label: "Roster",
    detail: "Add your club's people for this year.",
    done: facts.rosterCount !== null && facts.rosterCount > 0,
    reference: facts.rosterCount === null,
    href: `${base}/roster`,
    linkable: can.roster,
    unavailableNote: askDirector("to build the roster"),
    actionLabel: "Open roster",
    helpHref: portalGuideHref("director-roster-and-forms"),
  });
  add({
    id: "forms",
    label: "Club forms for the new year",
    detail: "Fill in each form the conference turned on.",
    done: false,
    reference: true,
    href: `${base}/forms`,
    linkable: isClubFormsRole(facts.role),
    unavailableNote: askDirector("to fill in the club forms"),
    actionLabel: "Open Forms",
    helpHref: portalGuideHref("director-roster-and-forms"),
  });
  const eventsKnown = facts.registeredEventCount !== null;
  add({
    id: "events",
    label: "Register for events",
    detail: facts.hasOpenEvents ? "Register your club for an open event." : "No event is open for your club yet. Watch Upcoming deadlines.",
    done: eventsKnown && facts.registeredEventCount! > 0,
    reference: !eventsKnown || (facts.registeredEventCount === 0 && !facts.hasOpenEvents),
    href: `${base}/events`,
    linkable: can.registerForEvents,
    unavailableNote: askDirector("to register the club"),
    actionLabel: "Open club events",
    helpHref: portalGuideHref("director-register-for-events"),
  });
  add({
    id: "orders",
    label: "Orders and supplies",
    detail: "Build the club's order list and count supplies on hand.",
    done: false,
    reference: true,
    href: `${base}/orders`,
    linkable: can.roster,
    unavailableNote: askDirector("to build the order list"),
    actionLabel: "Open Orders",
    helpHref: portalGuideHref("director-orders-and-supplies"),
  });
  add({
    id: "records",
    label: "Monthly Records",
    detail: facts.monthsNotSubmitted
      ? `${facts.monthsNotSubmitted} ${facts.monthsNotSubmitted === 1 ? "month has" : "months have"} no submitted record. A draft is not submitted.`
      : "File each month's record by the 10th of the next month.",
    done: facts.monthsNotSubmitted !== null && facts.monthsNotSubmitted === 0,
    reference: facts.monthsNotSubmitted === null,
    href: `${base}/records`,
    linkable: can.submitReports,
    unavailableNote: askDirector("to file the Monthly Records, or to give you the Reporter role"),
    actionLabel: "Open Monthly Records",
    helpHref: portalGuideHref("director-monthly-record"),
  });
  add({
    id: "sterling",
    label: "Honors and Sterling Volunteers",
    detail: facts.sterlingReminders ? "Someone on your roster needs a current Sterling Volunteers check." : "Record honors, and keep Sterling Volunteers current for adults and staff.",
    // Honors cannot be read as "done", and zero reminders also means an empty roster, so this is always a guide row.
    done: false,
    reference: true,
    href: `${base}/roster`,
    linkable: can.roster,
    unavailableNote: askDirector("about honors and Sterling Volunteers"),
    actionLabel: "Open roster",
    helpHref: portalGuideHref("director-honors-and-sterling"),
  });
  add({
    id: "help",
    label: "Where to get help",
    detail: "Search the Help guides, or contact the conference office.",
    done: false,
    reference: true,
    href: "/account/help",
    linkable: true,
    actionLabel: "Open Help",
    helpHref: portalGuideHref(GUIDE),
    helpLabel: "Getting started guide",
  });
  return summarizeChecklist(steps);
}

export const CLUB_CHECKLIST_GUIDE_HREF = portalGuideHref(GUIDE);

/** Months of the club year that have ended and have no submitted report. A draft is not submitted. */
export function monthsNotSubmitted(
  reports: ReadonlyArray<{ reportMonth: string; status: string }>,
  clubYear: string,
  now: Date,
  joinedOn: string | null,
): number {
  const started = new Set(reports.map((report) => report.reportMonth));
  const submitted = new Set(reports.filter((report) => report.status === "SUBMITTED").map((report) => report.reportMonth));
  return reportableMonths(clubYear, now, { joinedOn, keep: started }).filter((month) => monthHasEnded(month, now) && !submitted.has(month)).length;
}
