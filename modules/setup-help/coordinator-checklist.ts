import { summarizeChecklist, type Checklist, type ChecklistStep } from "./checklist";
import { CONFERENCE_OFFICE, portalGuideHref } from "./role-setup";

/**
 * The area coordinator's "Getting started" checklist on Overview (#1435, H5). Derived from the same rows the Overview
 * already shows (`CoordinatorOverview` over `getAreaClubsSummary`); rows the app cannot derive are guide links, never
 * checkmarks. Nothing is stored, and nothing here widens what a coordinator can see.
 */
export type CoordinatorChecklistFacts = {
  clubYear: string;
  clubCount: number;
  /** Clubs with no current director. */
  clubsWithoutDirector: number;
  /** The overview month's record: clubs without a submitted one, and whether the month is still under way. */
  recordsMissing: number;
  monthNotDue: boolean;
  monthLabel: string;
  /** Clubs with anything on Who's missing what. */
  clubsBehind: number;
};

export const WHOS_MISSING_ANCHOR = "whos-missing-what";
export const COORDINATOR_CHECKLIST_GUIDE_HREF = portalGuideHref("coordinator-getting-started");

export function buildCoordinatorChecklist(facts: CoordinatorChecklistFacts): Checklist {
  const steps: ChecklistStep[] = [
    {
      id: "clubs",
      label: "Your clubs",
      detail: "See every active club and open one. Your view is read only.",
      done: false,
      reference: true,
      href: "/account/clubs",
      linkable: true,
      actionLabel: "Open All clubs",
      helpHref: portalGuideHref("walkthrough-coordinator-clubs"),
    },
    {
      id: "directors",
      label: "A director for every club",
      detail: `${facts.clubsWithoutDirector} ${facts.clubsWithoutDirector === 1 ? "club has" : "clubs have"} no director.`,
      done: facts.clubCount > 0 && facts.clubsWithoutDirector === 0,
      reference: facts.clubCount === 0,
      href: `#${WHOS_MISSING_ANCHOR}`,
      // Only the conference adds a director, so there is no page to open: while one is missing it says who to ask (H4).
      linkable: facts.clubsWithoutDirector === 0,
      unavailableNote: `Ask ${CONFERENCE_OFFICE} to add one.`,
      actionLabel: "See which clubs",
      helpHref: portalGuideHref("walkthrough-coordinator-no-director"),
    },
    {
      id: "records",
      label: `${facts.monthLabel} Monthly Records`,
      detail: facts.monthNotDue ? "Not due yet. Records are due the 10th of the next month." : `${facts.recordsMissing} ${facts.recordsMissing === 1 ? "club has" : "clubs have"} not filed.`,
      done: !facts.monthNotDue && facts.clubCount > 0 && facts.recordsMissing === 0,
      reference: facts.monthNotDue || facts.clubCount === 0,
      href: `/account/area-clubs/reports?year=${encodeURIComponent(facts.clubYear)}`,
      linkable: true,
      actionLabel: "Open Monthly Records",
      helpHref: portalGuideHref("walkthrough-coordinator-records"),
    },
    {
      id: "behind",
      label: "Clubs that are behind",
      detail: `${facts.clubsBehind} ${facts.clubsBehind === 1 ? "club is" : "clubs are"} missing something. Each has one next step.`,
      done: facts.clubCount > 0 && facts.clubsBehind === 0,
      reference: facts.clubCount === 0,
      href: `#${WHOS_MISSING_ANCHOR}`,
      linkable: true,
      actionLabel: "See who's missing what",
      helpHref: portalGuideHref("walkthrough-coordinator-follow-up"),
    },
    {
      id: "points",
      label: "Points",
      detail: "See each club's points for the year.",
      done: false,
      reference: true,
      href: `/account/area-clubs/points?year=${encodeURIComponent(facts.clubYear)}`,
      linkable: true,
      actionLabel: "Open Points",
      helpHref: portalGuideHref("walkthrough-coordinator-points"),
    },
    {
      id: "approvals",
      label: "Team approvals",
      detail: "Decide team members of 18 or older when a club asks.",
      done: false,
      reference: true,
      href: "/account/area-clubs/team-permissions",
      linkable: true,
      actionLabel: "Open Team approvals",
      helpHref: portalGuideHref("coordinator-team-approvals"),
    },
    {
      id: "help",
      label: "Where to get help",
      detail: "Search the Help guides, or contact the conference office.",
      done: false,
      reference: true,
      href: "/account/help",
      linkable: true,
      actionLabel: "Open Help",
      helpHref: COORDINATOR_CHECKLIST_GUIDE_HREF,
      helpLabel: "Getting started guide",
    },
  ];
  return summarizeChecklist(steps);
}
